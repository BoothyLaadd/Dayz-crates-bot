// bot.js — DayZ Crates Bot (Replit-ready, no native deps)
// Features: role grants, dropdown removal + clear-all (with confirm),
// admin add (single & bulk), channel lock, expanded kits, currency tiers,
// WEIGHTED specials (Truck/Weapons Car/Storage Car common; Humvee/Build Spawn ultra-rare),
// category-colored embeds + SPECIAL title styling, uptime server import.

import 'dotenv/config'
import './server.js'

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import { LowSync } from 'lowdb'
import { JSONFileSync } from 'lowdb/node'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const TOKEN = process.env.BOT_TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const OPEN_CH = process.env.OPEN_CRATE_CHANNEL_ID || '1394016674004467772'

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing BOT_TOKEN or CLIENT_ID in environment variables')
  process.exit(1)
}

// ---- Loot settings ----
const SPECIAL_CHANCE = 0.05
// Weighted within specials (adds to 100% of the 5% bucket)
const SPECIAL_REWARDS = [
  { kind: 'item', name: "Builder's Truck", weight: 30, description: "Fully equipped mobile base-building vehicle." },
  { kind: 'item', name: 'Weapons Car', weight: 30, description: "A vehicle fully stocked with weapons." },
  { kind: 'item', name: 'Storage Car', weight: 30, description: "A vehicle loaded with tents, barrels, and storage." },
  { kind: 'item', name: 'Humvee', weight: 5, description: "Military-grade armored transport vehicle." },
  { kind: 'item', name: '24 Hour Build Spawn', weight: 5, description: "Special permit to place unlimited build items for 24 hours." },
]

const CATEGORY_WEIGHTS = [
  { cat: 'currency', weight: 40 },
  { cat: 'weapon', weight: 25 },
  { cat: 'kit', weight: 30 },
]

const CURRENCY_TIERS = [
  { name: 'common',   min: 1000,  max: 5000,   weight: 70 },
  { name: 'uncommon', min: 5001,  max: 15000,  weight: 20 },
  { name: 'rare',     min: 15001, max: 30000,  weight: 8  },
  { name: 'jackpot',  min: 30001, max: 50000,  weight: 2  },
]

const WEAPONS = [
  'M4A1', 'LAR (FAL)', 'SVD', 'VSS Vintorez', 'AK-101', 'AK-74',
  'M70 Tundra', 'Mosin 91/30', 'M16A2', 'AS VAL'
]

const KITS = [
  { name: 'Medical Kit', description: "Bandages, saline, morphine, and other essential medical supplies." },
  { name: 'Food Kit', description: "Canned goods, cooking pot, and utensils for survival." },
  { name: 'Hunter Kit', description: "Scoped rifle, hunting knife, and ammo." },
  { name: 'Camo Kit', description: "Ghillie suit and camo clothing for stealth." },
  { name: 'Clothing Kit', description: "Warm clothing and boots for harsh conditions." },
  { name: 'Repair Kit', description: "Weapon cleaning kit, sewing kit, duct tape." },
  { name: 'Vehicle Repair Kit', description: "Spare parts, wrench, and repair tools." },
  { name: 'Tool Kit', description: "Axe, shovel, saw, and other basic tools." },
  { name: 'Ammo Kit', description: "Mixed ammo types for various weapons." },
  { name: 'Survival Kit', description: "Matches, canteen, rope, tarp." },
]

# (truncated in the interest of space in Python; we'll append the rest below)

// ---- Helpers ----
function pickWeighted(bag) {
  const total = bag.reduce((a, b) => a + (b.weight || 1), 0)
  let r = Math.random() * total
  for (const x of bag) {
    r -= (x.weight || 1)
    if (r <= 0) return x
  }
  return bag[bag.length - 1]
}

function rollCurrencyAmount() {
  const tier = pickWeighted(CURRENCY_TIERS)
  const amount = tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1))
  return { kind: 'currency', name: 'DC', amount, currencyTier: tier.name }
}

function pickReward() {
  if (Math.random() < SPECIAL_CHANCE) {
    const s = pickWeighted(SPECIAL_REWARDS)
    return { ...s, amount: 1, special: true }
  }
  const cat = pickWeighted(CATEGORY_WEIGHTS).cat
  if (cat === 'currency') return rollCurrencyAmount()
  if (cat === 'weapon') return { kind: 'item', name: WEAPONS[Math.floor(Math.random() * WEAPONS.length)], amount: 1 }
  const kit = KITS[Math.floor(Math.random() * KITS.length)]
  return { kind: 'item', name: kit.name, description: kit.description, amount: 1 }
}

// ---- DB ----
const dbFile = path.join(process.cwd(), 'data.json')
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ users: {}, rewards: [] }, null, 2))
const adapter = new JSONFileSync(dbFile)
const db = new LowSync(adapter, { users: {}, rewards: [] })
db.read()

function ensureUser(userId) {
  if (!db.data.users[userId]) db.data.users[userId] = { crates: 0, created_at: new Date().toISOString() }
}
function addCrates(userId, qty) { ensureUser(userId); db.data.users[userId].crates += qty; db.write() }
function getCrates(userId) { ensureUser(userId); return db.data.users[userId].crates }
function decCrate(userId) { const c = getCrates(userId); if (c > 0) { db.data.users[userId].crates = c - 1; db.write(); return true } return false }
function addRewardRow(userId, reward) { const id = randomUUID(); db.data.rewards.unshift({ id, user_id: userId, ...reward, status: 'active', created_at: new Date().toISOString() }); db.write(); return id }
function listRewards(userId, limit, offset) { return db.data.rewards.filter(r => r.user_id === userId && r.status === 'active').slice(offset, offset + limit) }
function countRewards(userId) { return db.data.rewards.filter(r => r.user_id === userId && r.status === 'active').length }
function removeReward(id) { const r = db.data.rewards.find(x => x.id === id && x.status === 'active'); if (!r) return false; r.status = 'removed'; db.write(); return true }
function clearRewards(userId) {
  const rows = db.data.rewards.filter(r => r.user_id === userId && r.status === 'active')
  if (!rows.length) return 0
  for (const r of rows) r.status = 'removed'
  db.write()
  return rows.length
}

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some(r => r.name.toLowerCase() === 'crate giver')
}

function visualsFor(reward) {
  // Category-based colors
  const COLORS = {
    special: 0xf1c40f, // gold
    currency: 0x2ecc71, // green
    weapon: 0xe74c3c, // red
    kit: 0x3498db, // blue
    misc: 0x9b59b6, // purple
  }
  if (!reward) return { color: 0x00b894 }
  if (reward.special) return { color: COLORS.special }
  if (reward.kind === 'currency') return { color: COLORS.currency }
  const isWeapon = WEAPONS.includes(reward.name)
  return { color: isWeapon ? COLORS.weapon : COLORS.kit }
}

// ---- Commands ----
const commands = [
  {
    name: 'give-crate',
    description: 'Give crates to a member (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'member', description: 'Target member', type: 6, required: true },
      { name: 'qty', description: 'How many crates', type: 4, required: true, min_value: 1, max_value: 100 }
    ]
  },
  { name: 'open-crate', description: 'Open one of your crates' },
  {
    name: 'my-rewards',
    description: 'Show your active rewards',
    options: [{ name: 'page', description: 'Page number', type: 4, required: false }]
  },
  {
    name: 'member-rewards',
    description: 'View a member\'s active rewards (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'member', description: 'Target member', type: 6, required: true },
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]
  },
  {
    name: 'admin-remove-reward',
    description: 'Remove a reward by ID (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'item_id', description: 'Reward ID', type: 3, required: true },
      { name: 'note', description: 'Reason (echoed back)', type: 3, required: false }
    ]
  },
  {
    name: 'remove-reward-member',
    description: 'Remove a reward from a member via dropdown (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [{ name: 'member', description: 'Target member', type: 6, required: true }]
  },
  {
    name: 'give-crate-role',
    description: 'Give crates to all members with a role (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'role', description: 'Target role', type: 8, required: true },
      { name: 'qty', description: 'Crates each', type: 4, required: true, min_value: 1, max_value: 100 }
    ]
  },
  {
    name: 'admin-add-reward',
    description: 'Manually add a reward to a member (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'member', description: 'Target member', type: 6, required: true },
      { name: 'kind', description: 'currency | item', type: 3, required: true, choices: [
          { name: 'currency', value: 'currency' },
          { name: 'item', value: 'item' }
        ]
      },
      { name: 'name', description: 'Reward name (e.g., DC or Medical Kit)', type: 3, required: true },
      { name: 'amount', description: 'Amount/quantity', type: 4, required: true, min_value: 1, max_value: 1000000 },
      { name: 'special', description: 'Mark as special?', type: 5, required: false },
      { name: 'description', description: 'Optional description (shown in embeds for items)', type: 3, required: false }
    ]
  },
  {
    name: 'admin-add-rewards',
    description: 'Add multiple rewards to a member in one command (admin)',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      { name: 'member', description: 'Target member', type: 6, required: true },
      { name: 'rewards', description: 'Rewards string (e.g., currency,DC,5000; item,Medical Kit,1)', type: 3, required: true }
    ]
  }
]

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN)
if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands })

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] })
client.once('ready', () => console.log('Logged in as', client.user.tag))

client.on('interactionCreate', async itx => {
  try {
    if (itx.isChatInputCommand()) {
      ensureUser(itx.user.id)

      if (itx.commandName === 'give-crate-role') {
        const execMember = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })

        const role = itx.options.getRole('role', true)
        const qty = itx.options.getInteger('qty', true)

        await itx.deferReply({ ephemeral: false })

        const allMembers = await itx.guild.members.fetch()
        const targets = allMembers.filter(m => !m.user.bot && m.roles.cache.has(role.id))

        const total = targets.size
        if (!total) {
          return itx.editReply({ content: `No human members found with role ${role}.` })
        }
        if (total > 1000) {
          return itx.editReply({ content: `Role has ${total} members — too large for a single grant. Please narrow it down.` })
        }

        let granted = 0
        for (const m of targets.values()) {
          ensureUser(m.id)
          addCrates(m.id, qty)
          granted++
        }

        const embed = new EmbedBuilder()
          .setTitle('🎁 Crates Granted to Role')
          .addFields(
            { name: 'Role', value: `${role}`, inline: true },
            { name: 'Quantity', value: `${qty} each`, inline: true },
            { name: 'Members Affected', value: String(granted), inline: true },
          )
          .setColor(0x00b894)
          .setFooter({ text: `Requested by ${itx.user.username}` })
          .setTimestamp()

        return itx.editReply({ embeds: [embed] })
      }

      if (itx.commandName === 'give-crate') {
        const target = itx.options.getUser('member', true)
        const qty = itx.options.getInteger('qty', true)
        const member = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(member)) return itx.reply({ content: 'You lack permission.', ephemeral: true })
        addCrates(target.id, qty)
        return itx.reply({ embeds: [new EmbedBuilder()
          .setTitle('🎁 Crates Granted')
          .setDescription(`Gave **${qty}** crate(s) to ${target}.`)
          .setColor(0x00b894)
          .setFooter({ text: `Requested by ${itx.user.username}` })
          .setTimestamp()
        ] })
      }

      if (itx.commandName === 'open-crate') {
        if (OPEN_CH && itx.channelId !== OPEN_CH) return itx.reply({ content: `❌ You can only open crates in <#${OPEN_CH}>.`, ephemeral: true })
        const count = getCrates(itx.user.id)
        if (count <= 0) return itx.reply('You have no crates to open.')
        if (!decCrate(itx.user.id)) return itx.reply('Error opening crate.')

        const loot = pickReward()
        addRewardRow(itx.user.id, { kind: loot.kind, name: loot.name, amount: loot.amount, special: !!loot.special })

        const vis = visualsFor(loot)
        const isSpecial = !!loot.special
        const title = isSpecial ? `🎉 SPECIAL PRIZE! ${loot.name}` : '📦 Crate Opened'

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setColor(vis.color)
          .setTimestamp()

        if (loot.kind === 'currency') {
          embed.addFields({ name: 'Reward', value: `💰 **${loot.amount} ${loot.name}** (${loot.currencyTier.toUpperCase()})` })
        } else {
          embed.addFields({ name: 'Reward', value: `🏆 **${loot.name} x${loot.amount}**` })
          const specialObj = SPECIAL_REWARDS.find(s => s.name === loot.name)
          const desc = loot.description || specialObj?.description
          if (desc) embed.addFields({ name: 'Description', value: desc })
        }

        embed.addFields({ name: 'Crates Left', value: String(count - 1), inline: true })

        return itx.reply({ embeds: [embed] })
      }

      if (itx.commandName === 'my-rewards') {
        const page = Math.max(1, itx.options.getInteger('page') ?? 1), pageSize = 10
        const total = countRewards(itx.user.id)
        if (!total) return itx.reply('You have no active rewards.')
        const rows = listRewards(itx.user.id, pageSize, (page - 1) * pageSize)
        const lines = rows.map(r => `• **${r.name}** x${r.amount} — ${(r.special ? 'SPECIAL' : r.kind.toUpperCase())}`)
        return itx.reply({ embeds: [new EmbedBuilder()
          .setTitle(`🧳 ${itx.user.username}'s Rewards`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Page ${page}/${Math.max(1, Math.ceil(total / pageSize))}` })
          .setColor(0x3498db)
          .setTimestamp()
        ] })
      }

      if (itx.commandName === 'member-rewards') {
        const execMember = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })
        const target = itx.options.getUser('member', true)
        const page = Math.max(1, itx.options.getInteger('page') ?? 1), pageSize = 10
        const total = countRewards(target.id)
        if (!total) return itx.reply({ content: `${target} has no active rewards.`, ephemeral: true })
        const rows = listRewards(target.id, pageSize, (page - 1) * pageSize)
        const lines = rows.map(r => `• [\`${r.id}\`] **${r.name}** x${r.amount} — ${(r.special ? 'SPECIAL' : r.kind.toUpperCase())}`)
        return itx.reply({ embeds: [new EmbedBuilder()
          .setTitle(`🧳 ${target.username}'s Rewards (Admin)`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Page ${page}/${Math.max(1, Math.ceil(total / pageSize))}` })
          .setColor(0x6c5ce7)
          .setTimestamp()
        ], ephemeral: true })
      }

      if (itx.commandName === 'admin-add-rewards') {
        const execMember = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })

        const target = itx.options.getUser('member', true)
        const rewardsString = itx.options.getString('rewards', true)

        const entries = rewardsString.split(';').map(e => e.trim()).filter(Boolean)
        if (!entries.length) return itx.reply({ content: 'No rewards provided.', ephemeral: true })

        const addedList = []
        for (const entry of entries) {
          const parts = entry.split(',').map(p => p.trim())
          const kind = parts[0]?.toLowerCase()
          const name = parts[1]
          const amount = parseInt(parts[2], 10)
          let special = false
          let description
          for (let i = 3; i < parts.length; i++) {
            if (parts[i].toLowerCase().startsWith('special:')) {
              special = parts[i].split(':')[1]?.toLowerCase() === 'true'
            } else if (parts[i].toLowerCase().startsWith('description:')) {
              description = parts[i].substring(parts[i].indexOf(':')+1)
            }
          }
          if (!kind || !name || isNaN(amount)) continue
          if (kind !== 'currency' && kind !== 'item') continue

          addRewardRow(target.id, { kind, name, amount, special, description })
          addedList.push({ kind, name, amount, special, description })
        }

        if (!addedList.length) return itx.reply({ content: 'No valid rewards added.', ephemeral: true })

        const embed = new EmbedBuilder()
          .setTitle('➕ Multiple Rewards Added')
          .addFields(
            { name: 'Member', value: `${target}`, inline: false },
            { name: 'Rewards', value: addedList.map(r => {
                let line = r.kind === 'currency'
                  ? `💰 **${r.amount} ${r.name}**`
                  : `🏆 **${r.name} x${r.amount}**`
                if (r.special) line += ' ⭐'
                if (r.description) line += `\n*${r.description}*`
                return line
              }).join('\n'), inline: false }
          )
          .setColor(0x3498db)
          .setFooter({ text: `By ${itx.user.username}` })
          .setTimestamp()

        return itx.reply({ embeds: [embed] })
      }

      if (itx.commandName === 'admin-add-reward') {
        const execMember = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })

        const target = itx.options.getUser('member', true)
        const kind = itx.options.getString('kind', true)
        const name = itx.options.getString('name', true)
        const amount = itx.options.getInteger('amount', true)
        const special = itx.options.getBoolean('special') || false
        const description = itx.options.getString('description') || undefined

        if (kind !== 'currency' && kind !== 'item') {
          return itx.reply({ content: 'Kind must be currency or item.', ephemeral: true })
        }

        addRewardRow(target.id, { kind, name, amount, special, description })
        const vis = visualsFor({ kind, name, amount, special })
        return itx.reply({ embeds: [ new EmbedBuilder()
          .setTitle('➕ Reward Added')
          .addFields(
            { name: 'Member', value: `${target}`, inline: true },
            { name: 'Reward', value: kind === 'currency' ? `💰 **${amount} ${name}**` : `🏆 **${name} x${amount}**`, inline: true },
            { name: 'Special', value: special ? 'Yes' : 'No', inline: true },
          )
          .setDescription(description ? description : null)
          .setColor(vis.color)
          .setFooter({ text: `By ${itx.user.username}` })
          .setTimestamp()
        ]})
      }

      if (itx.commandName === 'admin-remove-reward') {
        const member = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(member)) return itx.reply({ content: 'You lack permission.', ephemeral: true })
        const itemId = itx.options.getString('item_id', true)
        const note = itx.options.getString('note') ?? ''
        const ok = removeReward(itemId)
        if (!ok) return itx.reply({ content: 'Reward not found.', ephemeral: true })
        return itx.reply({ embeds: [new EmbedBuilder()
          .setTitle('🗑️ Reward Removed')
          .addFields({ name: 'Reward ID', value: `\`${itemId}\`` }, { name: 'Note', value: note || '—' })
          .setColor(0xd63031)
          .setTimestamp()
        ], ephemeral: true })
      }

      if (itx.commandName === 'remove-reward-member') {
        const execMember = await itx.guild.members.fetch(itx.user.id)
        if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })
        const target = itx.options.getUser('member', true)
        const rewards = listRewards(target.id, 25, 0)
        if (!rewards.length) return itx.reply({ content: `${target} has no active rewards.`, ephemeral: true })

        const options = rewards.map(r =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${r.name} x${r.amount}`.slice(0, 100))
            .setValue(r.id)
        )

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`removeReward_${target.id}`)
          .setPlaceholder('Select a reward to remove')
          .addOptions(options)

        const row = new ActionRowBuilder().addComponents(menu)

        const clearBtn = new ButtonBuilder()
          .setCustomId(`clearRewards_${target.id}`)
          .setLabel('Clear all rewards')
          .setStyle(ButtonStyle.Danger)

        const buttons = new ActionRowBuilder().addComponents(clearBtn)

        return itx.reply({ content: `Select a reward to remove from ${target}:`, components: [row, buttons], ephemeral: true })
      }
    }

    if (itx.isStringSelectMenu() && itx.customId.startsWith('removeReward_')) {
      const execMember = await itx.guild.members.fetch(itx.user.id)
      if (!isAdmin(execMember)) return itx.reply({ content: 'You lack permission.', ephemeral: true })

      const rewardId = itx.values[0]
      const ok = removeReward(rewardId)
      if (!ok) return itx.reply({ content: 'Reward not found or already removed.', ephemeral: true })

      return itx.update({ content: `🗑️ Reward removed successfully.`, components: [] })
    }
  } catch (err) {
    console.error(err)
    if (itx.isRepliable()) itx.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {})
  }
})

client.login(TOKEN)

client.on('interactionCreate', async (btn) => {
  try {
    if (!btn.isButton()) return
    if (btn.customId.startsWith('confirmClear_')) {
      const execMember = await btn.guild.members.fetch(btn.user.id)
      if (!isAdmin(execMember)) return btn.reply({ content: 'You lack permission.', ephemeral: true })
      const targetId = btn.customId.split('_')[1]
      const removed = clearRewards(targetId)
      return btn.update({ content: removed ? `🧹 Cleared **${removed}** rewards.` : 'No active rewards to clear.', components: [] })
    }
    if (btn.customId.startsWith('cancelClear_')) {
      return btn.update({ content: '❌ Action cancelled.', components: [] })
    }
    if (btn.customId.startsWith('clearRewards_')) {
      const execMember = await btn.guild.members.fetch(btn.user.id)
      if (!isAdmin(execMember)) return btn.reply({ content: 'You lack permission.', ephemeral: true })

      const targetId = btn.customId.split('_')[1]
      const targetUser = await btn.client.users.fetch(targetId)
      const confirmBtn = new ButtonBuilder()
        .setCustomId(`confirmClear_${targetId}`)
        .setLabel('✅ Confirm')
        .setStyle(ButtonStyle.Danger)
      const cancelBtn = new ButtonBuilder()
        .setCustomId(`cancelClear_${targetId}`)
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)
      return btn.reply({ content: `Are you sure you want to clear all rewards for ${targetUser}?`, components: [row], ephemeral: true })
    }
  } catch (e) {
    console.error(e)
    if (btn.isRepliable()) btn.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {})
  }
})
