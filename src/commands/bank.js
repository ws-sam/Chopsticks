// src/commands/bank.js
import { SlashCommandBuilder } from "discord.js";
import { makeEmbed, Colors } from "../utils/discordOutput.js";
import { depositToBank, withdrawFromBank, getWallet, upgradeBankCapacity } from "../economy/wallet.js";

export const data = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Manage your bank account")
  .addSubcommand(s => s
    .setName("deposit")
    .setDescription("Deposit credits into your bank")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit").setRequired(false).setMinValue(1))
    .addBooleanOption(o => o.setName("all").setDescription("Deposit your entire wallet balance").setRequired(false))
  )
  .addSubcommand(s => s
    .setName("withdraw")
    .setDescription("Withdraw credits from your bank")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(false).setMinValue(1))
    .addBooleanOption(o => o.setName("all").setDescription("Withdraw your entire bank balance").setRequired(false))
  )
  .addSubcommand(s => s
    .setName("upgrade")
    .setDescription("Upgrade your bank capacity (cost scales)")
    .addIntegerOption(o => o.setName("levels").setDescription("How many upgrades to apply").setRequired(false).setMinValue(1).setMaxValue(20))
  )
  .addSubcommand(s => s.setName("view").setDescription("View your bank balance"));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  
  try {
    if (sub === "view") {
      const wallet = await getWallet(userId);
      
      const percentage = Math.floor((wallet.bank / wallet.bank_capacity) * 100);
      const progressBar = createProgressBar(percentage, 10);
      
      const fields = [
        { name: "🏦 Bank Balance", value: `${wallet.bank.toLocaleString()} Credits`, inline: true },
        { name: "📊 Capacity", value: `${wallet.bank_capacity.toLocaleString()} Credits`, inline: true },
        { name: "📈 Usage", value: `${progressBar} ${percentage}%`, inline: false }
      ];
      
      const embed = makeEmbed(
        "Bank Account",
        "Your credits are safe here!",
        fields,
        null,
        null,
        Colors.PRIMARY
      );
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "upgrade") {
      const levels = interaction.options.getInteger("levels") || 1;
      const res = await upgradeBankCapacity(userId, levels);
      if (!res.ok) {
        await interaction.reply({
          embeds: [makeEmbed("Insufficient Funds", "You don't have enough Credits in your wallet to upgrade your bank right now.", [], null, null, Colors.ERROR)],
          ephemeral: true
        });
        return;
      }

      const w = res.wallet;
      const embed = makeEmbed(
        "Bank Upgraded",
        `Applied **${res.applied}** upgrade(s) for **${res.totalCost.toLocaleString()} Credits**.\n\nNew capacity: **${Number(w.bank_capacity).toLocaleString()}**`,
        [
          { name: "Wallet", value: `${Number(w.balance).toLocaleString()} Credits`, inline: true },
          { name: "Bank", value: `${Number(w.bank).toLocaleString()} / ${Number(w.bank_capacity).toLocaleString()}`, inline: true }
        ],
        null,
        null,
        Colors.SUCCESS
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    const wallet = await getWallet(userId);
    const all = Boolean(interaction.options.getBoolean("all"));
    let amount = interaction.options.getInteger("amount");
    
    if (sub === "deposit") {
      if (all) amount = wallet.balance;
      if (!amount || amount <= 0) {
        await interaction.reply({
          embeds: [makeEmbed("Missing Amount", "Provide `amount` or enable `all`.", [], null, null, Colors.WARNING)],
          ephemeral: true
        });
        return;
      }
      
      const result = await depositToBank(userId, amount);
      
      if (!result.ok) {
        if (result.reason === "insufficient") {
          await interaction.reply({
            embeds: [makeEmbed("Insufficient Funds", "You don't have enough credits.", [], null, null, Colors.ERROR)],
            ephemeral: true
          });
          return;
        }
        
        if (result.reason === "capacity") {
          await interaction.reply({
            embeds: [makeEmbed("Bank Full", "Your bank is at capacity. Upgrade to store more!", [], null, null, Colors.ERROR)],
            ephemeral: true
          });
          return;
        }
      }
      
      const embed = makeEmbed(
        "Deposit Successful",
        `Deposited **${amount.toLocaleString()} Credits**\n\nNew bank balance: **${result.newBank.toLocaleString()} Credits**`,
        [],
        null,
        null,
        Colors.SUCCESS
      );
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (sub === "withdraw") {
      if (all) amount = wallet.bank;
      if (!amount || amount <= 0) {
        await interaction.reply({
          embeds: [makeEmbed("Missing Amount", "Provide `amount` or enable `all`.", [], null, null, Colors.WARNING)],
          ephemeral: true
        });
        return;
      }
      
      const result = await withdrawFromBank(userId, amount);
      
      if (!result.ok) {
        if (result.reason === "insufficient") {
          await interaction.reply({
            embeds: [makeEmbed("Insufficient Funds", "You don't have enough in your bank.", [], null, null, Colors.ERROR)],
            ephemeral: true
          });
          return;
        }
      }
      
      const embed = makeEmbed(
        "Withdrawal Successful",
        `Withdrew **${amount.toLocaleString()} Credits**\n\nNew wallet balance: **${result.newBalance.toLocaleString()} Credits**`,
        [],
        null,
        null,
        Colors.SUCCESS
      );
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    console.error("[bank] Error:", err);
    await interaction.reply({
      embeds: [makeEmbed("Error", "Failed to process bank transaction.", [], null, null, Colors.ERROR)],
      ephemeral: true
    });
  }
}

function createProgressBar(percentage, length = 10) {
  const filled = Math.floor((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
