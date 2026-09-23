const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js')

const TOKEN = process.env.TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const STAFF_CHANNEL_ID = process.env.STAFF_CHANNEL_ID
const PRONO_CHANNEL_ID = process.env.PRONO_CHANNEL_ID
const CLASSEMENT_CHANNEL_ID = process.env.CLASSEMENT_CHANNEL_ID

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

const matches = new Map()
const pronos = new Map()
const scores = new Map()
let saveMessageId = null

async function saveData() {
  try {
    const channel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const content = 'PRONO_DATA:' + JSON.stringify({
      matches: Object.fromEntries(matches),
      pronos: Object.fromEntries(pronos),
      scores: Object.fromEntries(scores)
    })
    if (saveMessageId) {
      const msg = await channel.messages.fetch(saveMessageId)
      await msg.edit(content)
    } else {
      const msg = await channel.send(content)
      saveMessageId = msg.id
    }
  } catch (e) {
    console.error('Erreur sauvegarde:', e.message)
  }
}

async function loadData() {
  try {
    const channel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const messages = await channel.messages.fetch({ limit: 20 })
    const dataMsg = messages.find(m => m.author.id === client.user.id && m.content.startsWith('PRONO_DATA:'))
    if (dataMsg) {
      const parsed = JSON.parse(dataMsg.content.replace('PRONO_DATA:', ''))
      if (parsed.matches) Object.entries(parsed.matches).forEach(([k, v]) => matches.set(k, v))
      if (parsed.pronos) Object.entries(parsed.pronos).forEach(([k, v]) => pronos.set(k, v))
      if (parsed.scores) Object.entries(parsed.scores).forEach(([k, v]) => scores.set(k, v))
      saveMessageId = dataMsg.id
      console.log(`${matches.size} matchs chargés`)
    }
  } catch (e) {
    console.log('Pas de données existantes')
  }
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('creer-match')
      .setDescription('Créer un nouveau match de pronos (admin)')
      .addStringOption(o => o.setName('titre').setDescription('Ex: France vs Belgique').setRequired(true))
      .addStringOption(o => o.setName('adversaire').setDescription('Nom de l\'adversaire').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Date et heure du match').setRequired(true))
      .addStringOption(o => o.setName('cloture').setDescription('Date/heure de clôture des pronos').setRequired(true))
      .addStringOption(o => o.setName('buteurs').setDescription('Buteurs possibles séparés par des virgules').setRequired(true))
      .addStringOption(o => o.setName('image').setDescription('URL de l\'image du match').setRequired(false)),

    new SlashCommandBuilder()
      .setName('fermer-match')
      .setDescription('Fermer les pronos d\'un match (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID du match').setRequired(true)),

    new SlashCommandBuilder()
      .setName('resultat')
      .setDescription('Entrer le résultat d\'un match et distribuer les points (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID du match').setRequired(true))
      .addStringOption(o => o.setName('resultat').setDescription('victoire_france / nul / defaite_france').setRequired(true))
      .addStringOption(o => o.setName('score').setDescription('Score exact (ex: 2-1)').setRequired(true))
      .addStringOption(o => o.setName('buteurs').setDescription('Buteurs français ayant marqué séparés par des virgules').setRequired(false)),

    new SlashCommandBuilder()
      .setName('classement')
      .setDescription('Afficher le classement général'),

    new SlashCommandBuilder()
      .setName('monprono')
      .setDescription('Voir mes pronos en cours'),

    new SlashCommandBuilder()
      .setName('listmatchs')
      .setDescription('Voir tous les matchs (admin)'),
  ].map(c => c.toJSON())

  const rest = new REST({ version: '10' }).setToken(TOKEN)
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  console.log('Commandes enregistrées')
}

function buildMatchEmbed(match) {
  const embed = new EmbedBuilder()
    .setTitle(`${match.titre}`)
    .setDescription(
      `📅 **${match.date}**\n\n` +
      `Fais ton pronostic avant la clôture et tente de grimper dans le classement !\n\n` +
      `**Système de points :**\n` +
      `✅ Bon résultat **5 pts**\n` +
      `🎯 Score exact **+15 pts bonus**\n` +
      `⚽ Bon buteur **+10 pts bonus**\n\n` +
      `⏰ Clôture : **${match.cloture}**`
    )
    .setColor('#0055A4')
    .setFooter({ text: `ID : ${match.id}` })

  if (match.image) embed.setImage(match.image)
  return embed
}

function buildPronoButton(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prono_${matchId}`)
      .setLabel('Faire mon pronostic')
      .setStyle(ButtonStyle.Primary)
  )
}

function buildClosedButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('closed')
      .setLabel('Pronos fermés')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  )
}

client.on('ready', async () => {
  console.log(`Bot connecté : ${client.user.tag}`)
  await registerCommands()
  await loadData()
})

client.on('interactionCreate', async interaction => {

  // CRÉER UN MATCH
  if (interaction.isChatInputCommand() && interaction.commandName === 'creer-match') {
    const isAdmin = interaction.member.permissions.has('Administrator')
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const titre = interaction.options.getString('titre')
    const adversaire = interaction.options.getString('adversaire')
    const date = interaction.options.getString('date')
    const cloture = interaction.options.getString('cloture')
    const image = interaction.options.getString('image')
    const buteursMatch = interaction.options.getString('buteurs').split(',').map(b => b.trim()).filter(Boolean)

    const matchId = `MATCH_${Date.now()}`
    const match = { id: matchId, titre, adversaire, date, cloture, image, buteurs: buteursMatch, statut: 'ouvert', messageId: null }

    matches.set(matchId, match)
    pronos.set(matchId, {})
    await saveData()

    const channel = await client.channels.fetch(PRONO_CHANNEL_ID)
    const msg = await channel.send({
      embeds: [buildMatchEmbed(match)],
      components: [buildPronoButton(matchId)]
    })

    match.messageId = msg.id
    matches.set(matchId, match)
    await saveData()

    await interaction.editReply({ content: `✅ Match créé ! ID : \`${matchId}\`` })
  }

  // FERMER UN MATCH
  if (interaction.isChatInputCommand() && interaction.commandName === 'fermer-match') {
    const isAdmin = interaction.member.permissions.has('Administrator')
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const matchId = interaction.options.getString('id')
    const match = matches.get(matchId)
    if (!match) return interaction.editReply({ content: '❌ Match introuvable.' })

    match.statut = 'fermé'
    matches.set(matchId, match)
    await saveData()

    try {
      const channel = await client.channels.fetch(PRONO_CHANNEL_ID)
      const msg = await channel.messages.fetch(match.messageId)
      await msg.edit({ components: [buildClosedButton()] })
    } catch (e) {
      console.error('Impossible de modifier le message:', e.message)
    }

    await interaction.editReply({ content: `✅ Pronos fermés pour **${match.titre}**` })
  }

  // BOUTON PRONO — étape 1 : sélection résultat
  if (interaction.isButton() && interaction.customId.startsWith('prono_')) {
    const matchId = interaction.customId.replace('prono_', '')
    const match = matches.get(matchId)
    if (!match || match.statut !== 'ouvert') return interaction.reply({ content: '❌ Les pronos sont fermés.', ephemeral: true })

    const selectResultat = new StringSelectMenuBuilder()
      .setCustomId(`select_resultat_${matchId}`)
      .setPlaceholder('Choisis le résultat du match')
      .addOptions([
        { label: 'Victoire France', value: 'victoire_france', emoji: '✅' },
        { label: 'Match Nul', value: 'nul', emoji: '🤝' },
        { label: `Victoire ${match.adversaire}`, value: 'defaite_france', emoji: '❌' }
      ])

    await interaction.reply({
      content: '**Étape 1/3** — Choisis le résultat du match :',
      components: [new ActionRowBuilder().addComponents(selectResultat)],
      ephemeral: true
    })
  }

  // SELECT RÉSULTAT — étape 2 : sélection buteur
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_resultat_')) {
    const matchId = interaction.customId.replace('select_resultat_', '')
    const match = matches.get(matchId)
    const resultat = interaction.values[0]

    const matchPronos = pronos.get(matchId) || {}
    if (!matchPronos[interaction.user.id]) matchPronos[interaction.user.id] = {}
    matchPronos[interaction.user.id].resultat = resultat
    matchPronos[interaction.user.id].username = interaction.user.username
    pronos.set(matchId, matchPronos)
    await saveData()

    const selectButeur = new StringSelectMenuBuilder()
      .setCustomId(`select_buteur_${matchId}`)
      .setPlaceholder('Choisis un buteur français')
      .addOptions([
        ...match.buteurs.map(j => ({ label: j, value: j })),
        { label: 'Aucun buteur français', value: 'aucun' }
      ])

    await interaction.update({
      content: '**Étape 2/3** — Choisis ton buteur français :',
      components: [new ActionRowBuilder().addComponents(selectButeur)]
    })
  }

  // SELECT BUTEUR — étape 3 : score exact
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_buteur_')) {
    const matchId = interaction.customId.replace('select_buteur_', '')
    const buteur = interaction.values[0]

    const matchPronos = pronos.get(matchId) || {}
    if (!matchPronos[interaction.user.id]) matchPronos[interaction.user.id] = {}
    matchPronos[interaction.user.id].buteur = buteur === 'aucun' ? null : buteur
    matchPronos[interaction.user.id].username = interaction.user.username
    pronos.set(matchId, matchPronos)
    await saveData()

    const rowScore = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`score_${matchId}`)
        .setLabel('Entrer mon score exact')
        .setStyle(ButtonStyle.Success)
    )

    const rowSkip = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`skip_score_${matchId}`)
        .setLabel('Passer le score')
        .setStyle(ButtonStyle.Secondary)
    )

    await interaction.update({
      content: '**Étape 3/3** — Entre ton score exact pour gagner +15 pts bonus :',
      components: [rowScore, rowSkip]
    })
  }

  // BOUTON SCORE
  if (interaction.isButton() && interaction.customId.startsWith('score_')) {
    const matchId = interaction.customId.replace('score_', '')

    const modal = new ModalBuilder()
      .setCustomId(`modal_score_${matchId}`)
      .setTitle('Score exact')

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('score')
          .setLabel('Score exact (ex: 2-1 pour la France)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Ex: 2-1')
      )
    )

    return interaction.showModal(modal)
  }

  // BOUTON PASSER SCORE
  if (interaction.isButton() && interaction.customId.startsWith('skip_score_')) {
    const matchId = interaction.customId.replace('skip_score_', '')
    const prono = pronos.get(matchId)?.[interaction.user.id]

    const resultatLabels = { victoire_france: 'Victoire France', nul: 'Match Nul', defaite_france: 'Victoire adversaire' }

    await interaction.update({
      content:
        `✅ **Pronostic enregistré !**\n\n` +
        `Résultat : **${resultatLabels[prono?.resultat] || 'non renseigné'}**\n` +
        `Score : **non renseigné**\n` +
        `Buteur : **${prono?.buteur || 'aucun'}**`,
      components: []
    })
  }

  // MODAL SCORE
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_score_')) {
    await interaction.deferReply({ ephemeral: true })

    const matchId = interaction.customId.replace('modal_score_', '')
    const score = interaction.fields.getTextInputValue('score').trim()

    const matchPronos = pronos.get(matchId) || {}
    if (!matchPronos[interaction.user.id]) matchPronos[interaction.user.id] = {}
    matchPronos[interaction.user.id].score = score
    pronos.set(matchId, matchPronos)
    await saveData()

    const prono = matchPronos[interaction.user.id]
    const resultatLabels = { victoire_france: 'Victoire France', nul: 'Match Nul', defaite_france: 'Victoire adversaire' }

    await interaction.editReply({
      content:
        `✅ **Pronostic enregistré !**\n\n` +
        `Résultat : **${resultatLabels[prono?.resultat] || 'non renseigné'}**\n` +
        `Score : **${score}**\n` +
        `Buteur : **${prono?.buteur || 'aucun'}**`
    })
  }

  // COMMANDE RÉSULTAT
  if (interaction.isChatInputCommand() && interaction.commandName === 'resultat') {
    const isAdmin = interaction.member.permissions.has('Administrator')
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const matchId = interaction.options.getString('id')
    const resultat = interaction.options.getString('resultat')
    const score = interaction.options.getString('score')
    const buteursStr = interaction.options.getString('buteurs') || ''
    const buteurs = buteursStr.split(',').map(b => b.trim().toLowerCase()).filter(Boolean)

    const match = matches.get(matchId)
    if (!match) return interaction.editReply({ content: '❌ Match introuvable.' })

    match.statut = 'terminé'
    matches.set(matchId, match)

    const matchPronos = pronos.get(matchId) || {}
    const gainsPts = {}

    for (const [userId, prono] of Object.entries(matchPronos)) {
      let pts = 0
      if (prono.resultat === resultat) pts += 5
      if (prono.score === score) pts += 15
      if (prono.buteur && buteurs.includes(prono.buteur.toLowerCase())) pts += 10

      if (pts > 0) {
        const current = scores.get(userId) || { username: prono.username, total: 0 }
        current.total += pts
        current.username = prono.username
        scores.set(userId, current)
        gainsPts[userId] = { username: prono.username, pts }
      }
    }

    await saveData()

    const resultatLabels = {
      victoire_france: 'Victoire France',
      nul: 'Match Nul',
      defaite_france: `Victoire ${match.adversaire}`
    }

    const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const gainsList = Object.values(gainsPts).sort((a, b) => b.pts - a.pts).slice(0, 10).map(g => `**${g.username}** +${g.pts} pts`).join('\n')

    await staffChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle(`✅ Résultats ${match.titre}`)
        .setDescription(
          `**Résultat :** ${resultatLabels[resultat]}\n` +
          `**Score :** ${score}\n` +
          `**Buteurs :** ${buteurs.join(', ') || 'Aucun'}\n\n` +
          `**Top gagnants :**\n${gainsList || 'Aucun'}`
        )
        .setColor('#00C853')]
    })

    await updateClassement()
    await interaction.editReply({ content: `✅ Résultat enregistré et points distribués !` })
  }

  // CLASSEMENT
  if (interaction.isChatInputCommand() && interaction.commandName === 'classement') {
    await interaction.deferReply()
    const embed = await buildClassementEmbed()
    await interaction.editReply({ embeds: [embed] })
  }

  // MON PRONO
  if (interaction.isChatInputCommand() && interaction.commandName === 'monprono') {
    await interaction.deferReply({ ephemeral: true })

    const userId = interaction.user.id
    const mesPronos = []

    for (const [matchId, matchPronos] of pronos.entries()) {
      const match = matches.get(matchId)
      if (!match || !matchPronos[userId]) continue
      const p = matchPronos[userId]
      const resultatLabel = { victoire_france: 'Victoire France', nul: 'Match Nul', defaite_france: `Victoire ${match.adversaire}` }
      mesPronos.push(
        `**${match.titre}** (${match.statut})\n` +
        `Résultat : ${resultatLabel[p.resultat] || 'non renseigné'}\n` +
        `Score : ${p.score || 'non renseigné'}\n` +
        `Buteur : ${p.buteur || 'aucun'}`
      )
    }

    const totalPts = scores.get(userId)?.total || 0

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Mes pronos')
        .setDescription(mesPronos.length ? mesPronos.join('\n\n') : 'Aucun prono enregistré.')
        .addFields({ name: '🏆 Total points', value: `${totalPts} pts` })
        .setColor('#0055A4')]
    })
  }

  // LIST MATCHS
  if (interaction.isChatInputCommand() && interaction.commandName === 'listmatchs') {
    const isAdmin = interaction.member.permissions.has('Administrator')
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    const list = [...matches.values()].map(m => `**${m.titre}** ${m.statut} ID: \`${m.id}\``).join('\n')
    await interaction.reply({ content: list || 'Aucun match.', ephemeral: true })
  }
})

async function buildClassementEmbed() {
  const sorted = [...scores.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10)
  const medals = ['🥇', '🥈', '🥉']
  const desc = sorted.map(([userId, data], i) => {
    const medal = medals[i] || `**${i + 1}.**`
    return `${medal} <@${userId}> **${data.total} pts**`
  }).join('\n')

  return new EmbedBuilder()
    .setTitle('🏆 Classement Général')
    .setDescription(desc || 'Aucun point pour l\'instant.')
    .setColor('#0055A4')
    .setFooter({ text: 'Classement mis à jour après chaque match' })
}

async function updateClassement() {
  try {
    const channel = await client.channels.fetch(CLASSEMENT_CHANNEL_ID)
    const messages = await channel.messages.fetch({ limit: 5 })
    const existing = messages.find(m => m.author.id === client.user.id)
    const embed = await buildClassementEmbed()
    if (existing) {
      await existing.edit({ embeds: [embed] })
    } else {
      await channel.send({ embeds: [embed] })
    }
  } catch (e) {
    console.error('Erreur mise à jour classement:', e.message)
  }
}

client.login(TOKEN)
