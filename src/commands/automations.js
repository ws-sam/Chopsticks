import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags
} from "discord.js";
import { Colors } from "../utils/discordOutput.js";
import { renderScriptDefinition } from "../scripting/renderer.js";
import { validateScriptDefinition } from "../scripting/validator.js";
import {
  upsertGuildScript,
  listGuildScripts,
  getGuildScript,
  setGuildScriptActive,
  deleteGuildScript,
  insertScriptAudit,
  checkScriptRunPermission,
  logScriptingError
} from "../scripting/store.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const TRIGGER_MAP = {
  join: "member_join",
  leave: "member_leave",
  message: "message_create"
};

function buildEmbed(title, description, color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || ""))
    .setColor(color)
    .setTimestamp();
}

function buildContext(interaction, targetUser = null, channel = null) {
  const user = targetUser || interaction.user;
  const destination = channel || interaction.channel;
  return {
    user: {
      id: user?.id,
      username: user?.username || user?.globalName || "user",
      name: user?.displayName || user?.username || "user"
    },
    guild: {
      id: interaction.guildId,
      name: interaction.guild?.name || "guild"
    },
    channel: {
      id: destination?.id || interaction.channelId,
      name: destination?.name || interaction.channel?.name || "channel"
    }
  };
}

function triggerValueFor(eventKey, channelId = null) {
  if (channelId) return `${eventKey}@${channelId}`;
  return eventKey;
}

function parseTriggerLabel(triggerValue) {
  const raw = String(triggerValue || "").toLowerCase();
  const [eventKey, channelId] = raw.split("@");
  const friendly = Object.entries(TRIGGER_MAP).find(([, value]) => value === eventKey)?.[0] || eventKey || "unknown";
  return {
    label: friendly,
    eventKey,
    channelId: /^\d{16,21}$/.test(String(channelId || "")) ? channelId : null
  };
}

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "admin"
};

export const data = new SlashCommandBuilder()
  .setName("automations")
  .setDescription("Event-triggered script automations")
  .addSubcommand(sub =>
    sub
      .setName("create")
      .setDescription("Create or update an event automation from a message template")
      .addStringOption(o => o.setName("name").setDescription("Automation name").setRequired(true))
      .addStringOption(o =>
        o
          .setName("trigger")
          .setDescription("Trigger event")
          .setRequired(true)
          .addChoices(
            { name: "Member Join", value: "join" },
            { name: "Member Leave", value: "leave" },
            { name: "Message Create", value: "message" }
          )
      )
      .addStringOption(o => o.setName("template").setDescription("Message template (supports {{user.name}}, {{guild.name}}, etc.)").setRequired(true))
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Optional target channel override")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addBooleanOption(o => o.setName("active").setDescription("Enable immediately").setRequired(false))
  )
  .addSubcommand(sub =>
    sub
      .setName("template")
      .setDescription("Create a starter automation template")
      .addStringOption(o =>
        o
          .setName("type")
          .setDescription("Template type")
          .setRequired(true)
          .addChoices(
            { name: "Welcome Join", value: "welcome_join" },
            { name: "Farewell Leave", value: "farewell_leave" },
            { name: "Message Pulse", value: "message_pulse" }
          )
      )
      .addStringOption(o => o.setName("name").setDescription("Automation name override").setRequired(false))
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Target channel override")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addBooleanOption(o => o.setName("active").setDescription("Enable immediately").setRequired(false))
  )
  .addSubcommand(sub =>
    sub
      .setName("list")
      .setDescription("List event automations in this server")
      .addBooleanOption(o => o.setName("active_only").setDescription("Only list enabled automations").setRequired(false))
  )
  .addSubcommand(sub =>
    sub
      .setName("enable")
      .setDescription("Enable an automation")
      .addStringOption(o => o.setName("script_id").setDescription("Automation script ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("disable")
      .setDescription("Disable an automation")
      .addStringOption(o => o.setName("script_id").setDescription("Automation script ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("delete")
      .setDescription("Delete an automation")
      .addStringOption(o => o.setName("script_id").setDescription("Automation script ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("run")
      .setDescription("Run an automation manually for testing")
      .addStringOption(o => o.setName("script_id").setDescription("Automation script ID").setRequired(true))
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Optional destination channel")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addUserOption(o => o.setName("target_user").setDescription("Optional target user context").setRequired(false))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const actorUserId = interaction.user.id;
  const sub = interaction.options.getSubcommand(true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withTimeout(interaction, async () => {

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const trigger = interaction.options.getString("trigger", true);
      const template = interaction.options.getString("template", true);
      const channel = interaction.options.getChannel("channel", false);
      const active = interaction.options.getBoolean("active", false);
      const eventKey = TRIGGER_MAP[trigger];

      if (!eventKey) {
        await interaction.editReply({
          embeds: [buildEmbed("Invalid Trigger", "Unsupported trigger value.", Colors.ERROR)]
        });
        return;
      }

      try {
        const definition = validateScriptDefinition({
          trigger: {
            type: "event",
            value: triggerValueFor(eventKey, channel?.id || null)
          },
          permissions: { mode: "everyone", roleIds: [] },
          variables: {},
          message: { content: template, embeds: [], buttons: [] }
        });

        const result = await upsertGuildScript({
          guildId,
          name,
          triggerType: "event",
          triggerValue: definition.trigger.value,
          definition,
          isActive: active === null ? true : Boolean(active),
          actorUserId,
          changeNote: "automations:create"
        });

        const trg = parseTriggerLabel(definition.trigger.value);
        const channelLine = trg.channelId ? `\nChannel: <#${trg.channelId}>` : "";
        await interaction.editReply({
          embeds: [
            buildEmbed(
              result.mode === "created" ? "Automation Created" : "Automation Updated",
              `Name: **${result.name}**\nScript ID: \`${result.scriptId}\`\nTrigger: **${trg.label}**${channelLine}`,
              Colors.SUCCESS
            )
          ]
        });
        return;
      } catch (error) {
        logScriptingError({ op: "automations:create", guildId, actorUserId }, error);
        await interaction.editReply({
          embeds: [buildEmbed("Create Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
        return;
      }
    }

    if (sub === "template") {
      const type = interaction.options.getString("type", true);
      const overrideName = interaction.options.getString("name", false);
      const channel = interaction.options.getChannel("channel", false);
      const active = interaction.options.getBoolean("active", false);

      const templates = {
        welcome_join: {
          name: "welcome_join",
          eventKey: "member_join",
          message: "Welcome {{user.mention}} to **{{guild.name}}**. Read the rules and enjoy your stay."
        },
        farewell_leave: {
          name: "farewell_leave",
          eventKey: "member_leave",
          message: "**{{user.name}}** has left {{guild.name}}."
        },
        message_pulse: {
          name: "message_pulse",
          eventKey: "message_create",
          message: "Message pulse: **{{user.name}}** posted in **{{channel.name}}**."
        }
      };

      const tpl = templates[type];
      if (!tpl) {
        await interaction.editReply({
          embeds: [buildEmbed("Invalid Template", "Unknown automation template type.", Colors.ERROR)]
        });
        return;
      }

      try {
        const definition = validateScriptDefinition({
          trigger: {
            type: "event",
            value: triggerValueFor(tpl.eventKey, channel?.id || null)
          },
          permissions: { mode: "everyone", roleIds: [] },
          variables: {},
          message: { content: tpl.message, embeds: [], buttons: [] }
        });

        const name = (overrideName || tpl.name).trim().slice(0, 64);
        const result = await upsertGuildScript({
          guildId,
          name,
          triggerType: "event",
          triggerValue: definition.trigger.value,
          definition,
          isActive: active === null ? true : Boolean(active),
          actorUserId,
          changeNote: `automations:template:${type}`
        });

        const trg = parseTriggerLabel(definition.trigger.value);
        await interaction.editReply({
          embeds: [
            buildEmbed(
              "Template Applied",
              `Template: **${type}**\nName: **${result.name}**\nScript ID: \`${result.scriptId}\`\nTrigger: **${trg.label}**${trg.channelId ? ` • <#${trg.channelId}>` : ""}`,
              Colors.SUCCESS
            )
          ]
        });
        return;
      } catch (error) {
        logScriptingError({ op: "automations:template", guildId, actorUserId, type }, error);
        await interaction.editReply({
          embeds: [buildEmbed("Template Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
        return;
      }
    }

    if (sub === "list") {
      try {
        const activeOnly = interaction.options.getBoolean("active_only", false) === true;
        const all = await listGuildScripts(guildId, { activeOnly, limit: 100 });
        const items = all.filter(s => String(s.trigger_type || "") === "event");

        if (!items.length) {
          await interaction.editReply({
            embeds: [buildEmbed("No Automations", "No event automations found in this server.", Colors.INFO)]
          });
          return;
        }

        const lines = items.slice(0, 25).map((s, idx) => {
          const trg = parseTriggerLabel(s.trigger_value);
          const ch = trg.channelId ? ` • <#${trg.channelId}>` : "";
          return `${idx + 1}. \`${s.script_id}\` • **${s.name}** • ${trg.label}${ch} • ${s.is_active ? "enabled" : "disabled"}`;
        });

        await interaction.editReply({
          embeds: [
            buildEmbed("Event Automations", lines.join("\n"), Colors.INFO).setFooter({
              text: items.length > 25 ? `Showing 25 of ${items.length}` : `${items.length} automation(s)`
            })
          ]
        });
        return;
      } catch (error) {
        logScriptingError({ op: "automations:list", guildId, actorUserId }, error);
        await interaction.editReply({
          embeds: [buildEmbed("List Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
        return;
      }
    }

    if (sub === "enable" || sub === "disable") {
      const scriptId = interaction.options.getString("script_id", true);
      const enable = sub === "enable";
      try {
        const row = await setGuildScriptActive(guildId, scriptId, enable, actorUserId);
        if (!row) {
          await interaction.editReply({
            embeds: [buildEmbed("Not Found", "Automation script not found.", Colors.WARNING)]
          });
          return;
        }
        await interaction.editReply({
          embeds: [buildEmbed(enable ? "Automation Enabled" : "Automation Disabled", `\`${row.name}\` (\`${row.script_id}\`)`, Colors.SUCCESS)]
        });
        return;
      } catch (error) {
        logScriptingError({ op: "automations:toggle", guildId, actorUserId, scriptId }, error);
        await interaction.editReply({
          embeds: [buildEmbed("Update Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
        return;
      }
    }

    if (sub === "delete") {
      const scriptId = interaction.options.getString("script_id", true);
      try {
        const deleted = await deleteGuildScript(guildId, scriptId, actorUserId);
        if (!deleted) {
          await interaction.editReply({
            embeds: [buildEmbed("Not Found", "Automation script not found.", Colors.WARNING)]
          });
          return;
        }
        await interaction.editReply({
          embeds: [buildEmbed("Automation Deleted", `Deleted **${deleted.name}** (\`${deleted.script_id}\`).`, Colors.SUCCESS)]
        });
        return;
      } catch (error) {
        logScriptingError({ op: "automations:delete", guildId, actorUserId, scriptId }, error);
        await interaction.editReply({
          embeds: [buildEmbed("Delete Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
        return;
      }
    }

    const scriptId = interaction.options.getString("script_id", true);
    const destination = interaction.options.getChannel("channel", false);
    const targetUser = interaction.options.getUser("target_user", false);
    try {
      const script = await getGuildScript(guildId, scriptId);
      if (!script) {
        await interaction.editReply({
          embeds: [buildEmbed("Not Found", "Automation script not found.", Colors.WARNING)]
        });
        return;
      }
      if (!script.is_active) {
        await interaction.editReply({
          embeds: [buildEmbed("Automation Disabled", "Enable the automation before running it.", Colors.WARNING)]
        });
        return;
      }
      if (String(script.trigger_type || "") !== "event") {
        await interaction.editReply({
          embeds: [buildEmbed("Wrong Script Type", "This command only runs event automations.", Colors.ERROR)]
        });
        return;
      }

      const allowed = await checkScriptRunPermission(script, interaction.member);
      if (!allowed) {
        await interaction.editReply({
          embeds: [buildEmbed("Permission Denied", "You are not allowed to run this automation.", Colors.ERROR)]
        });
        return;
      }

      const targetChannel = destination || interaction.channel;
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply({
          embeds: [buildEmbed("Invalid Channel", "Destination channel must be text-based.", Colors.ERROR)]
        });
        return;
      }

      const rendered = renderScriptDefinition(script.definition, buildContext(interaction, targetUser, targetChannel));
      await targetChannel.send(rendered.payload);
      await insertScriptAudit({
        guildId,
        scriptId: script.script_id,
        actorUserId,
        action: "run",
        details: { mode: "automations_run", channelId: targetChannel.id, targetUserId: targetUser?.id || null }
      });

      await interaction.editReply({
        embeds: [buildEmbed("Automation Executed", `Ran \`${script.name}\` in <#${targetChannel.id}>.`, Colors.SUCCESS)]
      });
    } catch (error) {
      logScriptingError({ op: "automations:run", guildId, actorUserId, scriptId }, error);
      await interaction.editReply({
        embeds: [buildEmbed("Run Failed", error.message || "Unknown error.", Colors.ERROR)]
      });
    }
  }, { label: "automations" });
}

export default { data, execute, meta };
