import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "util", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("github")
  .setDescription("Look up a GitHub user or repository")
  .addStringOption(o =>
    o.setName("query")
      .setDescription("GitHub username (e.g. octocat) or repo (e.g. octocat/Hello-World)")
      .setRequired(true)
  );

const GITHUB_API = "https://api.github.com";

async function fetchGitHub(path) {
  const headers = {
    "User-Agent": "Chopsticks-Discord-Bot/1.0",
    "Accept": "application/vnd.github+json"
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const { statusCode, body } = await httpRequest("github", `${GITHUB_API}${path}`, { headers });
  if (statusCode === 404) return null;
  if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return body.json();
}

export async function execute(interaction) {
  await interaction.deferReply();

  await withTimeout(interaction, async () => {
    const query = interaction.options.getString("query", true).trim();
    const isRepo = query.includes("/");

    try {
      if (isRepo) {
        const repo = await fetchGitHub(`/repos/${query}`);
        if (!repo) return interaction.editReply({ content: `❌ Repository \`${query}\` not found.` });

        const embed = new EmbedBuilder()
          .setTitle(`📦 ${repo.full_name}`)
          .setURL(repo.html_url)
          .setDescription(repo.description?.slice(0, 300) ?? "No description.")
          .setThumbnail(repo.owner?.avatar_url ?? null)
          .setColor(0x24292f)
          .addFields(
            { name: "⭐ Stars", value: repo.stargazers_count.toLocaleString(), inline: true },
            { name: "🍴 Forks", value: repo.forks_count.toLocaleString(), inline: true },
            { name: "🔍 Open Issues", value: repo.open_issues_count.toLocaleString(), inline: true },
            { name: "🌐 Language", value: repo.language ?? "N/A", inline: true },
            { name: "📄 License", value: repo.license?.spdx_id ?? "None", inline: true },
            { name: "👁️ Watchers", value: repo.watchers_count.toLocaleString(), inline: true }
          )
          .setFooter({ text: `Updated ${new Date(repo.updated_at).toLocaleDateString()}` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // User lookup
      const user = await fetchGitHub(`/users/${query}`);
      if (!user) return interaction.editReply({ content: `❌ GitHub user \`${query}\` not found.` });

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.login}${user.name ? ` (${user.name})` : ""}`)
        .setURL(user.html_url)
        .setDescription(user.bio?.slice(0, 300) ?? "No bio.")
        .setThumbnail(user.avatar_url)
        .setColor(0x24292f)
        .addFields(
          { name: "📦 Public Repos", value: user.public_repos.toLocaleString(), inline: true },
          { name: "👥 Followers", value: user.followers.toLocaleString(), inline: true },
          { name: "👣 Following", value: user.following.toLocaleString(), inline: true }
        )
        .setFooter({ text: `Joined ${new Date(user.created_at).toLocaleDateString()}` })
        .setTimestamp();

      if (user.location) embed.addFields({ name: "📍 Location", value: user.location, inline: true });
      if (user.company) embed.addFields({ name: "🏢 Company", value: user.company, inline: true });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err, query }, "[github] fetch failed");
      return interaction.editReply({ content: "❌ Couldn't fetch GitHub data right now. Try again later." });
    }
  }, { label: "github" });
}
