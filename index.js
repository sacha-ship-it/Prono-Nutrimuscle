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
let classementMessageId = null

async function saveData() {
  try {
    const channel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const content = 'PRONO_DATA:' + JSON.stringify({
      matches: Object.fromEntries(matches),
      pronos: Object.fromEntries(pronos),
      scores: Object.fromEntries(scores),
      classementMessageId
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
      if (parsed.classementMessageId) classementMessageId = parsed.classementMessageId
      saveMessageId = dataMsg.id

      // Relancer les timers pour les matchs encore ouverts
      for (const [matchId, match] of matches.entries()) {
        if (match.statut === 'ouvert' && match.cloture) {
          scheduleAutoClose(matchId, match.cloture)
        }
      }

      console.log(`${matches.size} matchs chargés`)
    }
  } catch (e) {
    console.log('Pas de données existantes')
  }
}

function scheduleAutoClose(matchId, cloture) {
  const closingDate = new Date(cloture)
  const now = new Date()
  const delay = closingDate - now

  if (delay > 0) {
    setTimeout(async () => {
      const match = matches.get(matchId)
      if (match && match.statut === 'ouvert') {
        match.statut = 'fermé'
        matches.set(matchId, match)
        await saveData()
        try {
          const ch = await client.channels.fetch(PRONO_CHANNEL_ID)
          const message = await ch.messages.fetch(match.messageId)
          await message.edit({ components: [buildClosedButton()] })
          console.log(`Match ${matchId} fermé automatiquement`)
        } catch (e) {
          console.error('Erreur fermeture auto:', e.message)
        }
      }
    }, delay)
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
      .addStringOption(o => o.setName('cloture').setDescription('Clôture format: 2026-09-28 20:00 (heure Paris)').setRequired(true))
      .addStringOption(o => o.setName('buteurs').setDescription('Buteurs potentiels des 2 équipes séparés par des virgules').setRequired(true))
      .addStringOption(o => o.setName('image').setDescription('URL de l\'image du match').setRequired(false)),

    new SlashCommandBuilder()
      .setName('fermer-match')
      .setDescription('Fermer les pronos d\'un match manuellement (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID du match').setRequired(true)),

    new SlashCommandBuilder()
      .setName('resultat')
      .setDescription('Entrer le résultat d\'un match (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID du match').setRequired(true))
      .addStringOption(o => o.setName('resultat').setDescription('victoire_france / nul / defaite_france').setRequired(true))
      .addStringOption(o => o.setName('score').setDescription('Score exact (ex: 2-1)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('publier-classement')
      .setDescription('Publier le classement dans le canal dédié (admin)'),

    new SlashCommandBuilder()
      .setName('reset-classement')
      .setDescription('Remettre le classement à zéro (admin)'),

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

function parseDateParis(dateStr) {
  // Format attendu: "2026-09-28 20:00"
  const [datePart, timePart] = dateStr.trim().split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes] = timePart.split(':').map(Number)

  // Créer la date en heure Paris sans décalage
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0))
  // Soustraire l'offset Paris (UTC+2 en été, UTC+1 en hiver)
  const parisOffset = getParisTZOffset(date)
  return new Date(date.getTime() - parisOffset * 60 * 1000)
}

function getParisTZOffset(date) {
  // Retourne l'offset en minutes pour l'heure de Paris
  const parisTime = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(date)

  const utcHours = date.getUTCHours()
  const utcMinutes = date.getUTCMinutes()
  const parisHours = parseInt(parisTime.find(p => p.type === 'hour').value)
  const parisMinutes = parseInt(parisTime.find(p => p.type === 'minute').value)

  return (parisHours * 60 + parisMinutes) - (utcHours * 60 + utcMinutes)
}

function formatDateParis(isoDate) {
  return new Date(isoDate).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
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
      `⏰ Clôture : **${formatDateParis(match.cloture)}**`
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

async function buildClassementEmbed() {
  const sorted = [...scores.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)
  const medals = ['🥇', '🥈', '🥉']
  const desc = sorted.length > 0
    ? sorted.map(([userId, data], i) => {
        const medal = medals[i] || `**${i + 1}.**`
        return `${medal} <@${userId}> **${data.total} pts**`
      }).join('\n')
    : 'Aucun point pour l\'instant.'

  return new EmbedBuilder()
    .setTitle('🏆 Classement Général')
    .setDescription(desc)
    .setColor('#0055A4')
    .setFooter({ text: 'Classement publié manuellement' })
    .setTimestamp()
}

client.on('ready', async () => {
  console.log(`Bot connecté : ${client.user.tag}`)
  await registerCommands()
  await loadData()
})

client.on('interactionCreate', async interaction => {

  const isAdmin = interaction.isChatInputCommand()
    ? interaction.member.permissions.has('Administrator')
    : false

  // CRÉER UN MATCH
  if (interaction.isChatInputCommand() && interaction.commandName === 'creer-match') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const titre = interaction.options.getString('titre')
    const adversaire = interaction.options.getString('adversaire')
    const date = interaction.options.getString('date')
    const clotureStr = interaction.options.getString('cloture')
    const image = interaction.options.getString('image')
    const buteursMatch = interaction.options.getString('buteurs').split(',').map(b => b.trim()).filter(Boolean)

    let closingDate
    try {
      closingDate = parseDateParis(clotureStr)
      if (isNaN(closingDate.getTime())) throw new Error('Date invalide')
    } catch (e) {
      return interaction.editReply({ content: '❌ Format de date invalide. Utilise : 2026-09-28 20:00' })
    }

    const matchId = `MATCH_${Date.now()}`
    const match = {
      id: matchId,
      titre,
      adversaire,
      date,
      cloture: closingDate.toISOString(),
      image,
      buteurs: buteursMatch,
      statut: 'ouvert',
      messageId: null
    }

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

    scheduleAutoClose(matchId, closingDate.toISOString())

    await interaction.editReply({
      content: `✅ Match créé !\n**ID :** \`${matchId}\`\nFermeture automatique le **${formatDateParis(closingDate.toISOString())}**`
    })
  }

  // FERMER UN MATCH
  if (interaction.isChatInputCommand() && interaction.commandName === 'fermer-match') {
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
      .setPlaceholder('Choisis un buteur')
      .addOptions([
        ...match.buteurs.map(j => ({ label: j, value: j })),
        { label: 'Aucun buteur', value: 'aucun', emoji: '🚫' }
      ])

    await interaction.update({
      content: '**Étape 2/3** — Choisis un buteur du match :',
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

  // COMMANDE RÉSULTAT — avec sélection des buteurs parmi ceux du match
  if (interaction.isChatInputCommand() && interaction.commandName === 'resultat') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const matchId = interaction.options.getString('id')
    const resultat = interaction.options.getString('resultat')
    const score = interaction.options.getString('score')

    const match = matches.get(matchId)
    if (!match) return interaction.editReply({ content: '❌ Match introuvable.' })

    // Proposer les buteurs du match comme sélection
    const selectButeurs = new StringSelectMenuBuilder()
      .setCustomId(`resultat_buteurs_${matchId}_${resultat}_${encodeURIComponent(score)}`)
      .setPlaceholder('Sélectionne les buteurs ayant marqué')
      .setMinValues(1)
      .setMaxValues(match.buteurs.length + 1)
      .addOptions([
        ...match.buteurs.map(j => ({ label: j, value: j })),
        { label: 'Aucun buteur', value: 'aucun', emoji: '🚫' }
      ])

    await interaction.editReply({
      content: `**Match :** ${match.titre}\n**Résultat :** ${resultat}\n**Score :** ${score}\n\nSélectionne les buteurs ayant marqué :`,
      components: [new ActionRowBuilder().addComponents(selectButeurs)]
    })
  }

  // SELECT BUTEURS RÉSULTAT
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('resultat_buteurs_')) {
    await interaction.deferUpdate()

    const parts = interaction.customId.split('_')
    const matchId = parts[2]
    const resultat = parts[3]
    const score = decodeURIComponent(parts[4])
    const buteurs = interaction.values.includes('aucun') ? [] : interaction.values.map(b => b.toLowerCase())

    const match = matches.get(matchId)
    if (!match) return interaction.followUp({ content: '❌ Match introuvable.', ephemeral: true })

    match.statut = 'terminé'
    matches.set(matchId, match)

    const matchPronos = pronos.get(matchId) || {}
    const gainsPts = {}

    for (const [userId, prono] of Object.entries(matchPronos)) {
      let pts = 0
      if (prono.resultat === resultat) pts += 5
      if (prono.score === score) pts += 15
      if (buteurs.length > 0 && prono.buteur && buteurs.includes(prono.buteur.toLowerCase())) pts += 10
      if (buteurs.length === 0 && prono.buteur === null) pts += 10

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

    const gainsList = Object.values(gainsPts)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 10)
      .map(g => `**${g.username}** +${g.pts} pts`)
      .join('\n')

    const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID)
    await staffChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle(`✅ Résultats ${match.titre}`)
        .setDescription(
          `**Résultat :** ${resultatLabels[resultat]}\n` +
          `**Score :** ${score}\n` +
          `**Buteurs :** ${buteurs.length > 0 ? buteurs.join(', ') : 'Aucun'}\n\n` +
          `**Points distribués — Top gagnants :**\n${gainsList || 'Aucun'}\n\n` +
          `⚠️ Le classement n\'a pas été mis à jour automatiquement. Utilise **/publier-classement** quand tu es prêt.`
        )
        .setColor('#00C853')]
    })

    await interaction.followUp({ content: '✅ Résultat enregistré et points distribués ! Utilise **/publier-classement** pour mettre à jour le classement.', ephemeral: true })
  }

  // PUBLIER CLASSEMENT
  if (interaction.isChatInputCommand() && interaction.commandName === 'publier-classement') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    await interaction.deferReply({ ephemeral: true })

    const embed = await buildClassementEmbed()
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('voir_ma_position')
        .setLabel('Voir ma position')
        .setStyle(ButtonStyle.Secondary)
    )

    const channel = await client.channels.fetch(CLASSEMENT_CHANNEL_ID)

    if (classementMessageId) {
      try {
        const existingMsg = await channel.messages.fetch(classementMessageId)
        await existingMsg.edit({ embeds: [embed], components: [row] })
      } catch (e) {
        const newMsg = await channel.send({ embeds: [embed], components: [row] })
        classementMessageId = newMsg.id
      }
    } else {
      const newMsg = await channel.send({ embeds: [embed], components: [row] })
      classementMessageId = newMsg.id
    }

    await saveData()
    await interaction.editReply({ content: '✅ Classement publié !' })
  }

  // BOUTON VOIR MA POSITION
  if (interaction.isButton() && interaction.customId === 'voir_ma_position') {
    const userId = interaction.user.id
    const sorted = [...scores.entries()].sort((a, b) => b[1].total - a[1].total)
    const position = sorted.findIndex(([id]) => id === userId) + 1
    const userScore = scores.get(userId)

    if (!userScore) {
      return interaction.reply({ content: '❌ Tu n\'as pas encore de points.', ephemeral: true })
    }

    await interaction.reply({
      content: `📊 **Ta position dans le classement :**\n\n**#${position}** sur ${sorted.length} joueurs\n**Points :** ${userScore.total} pts`,
      ephemeral: true
    })
  }

  // RESET CLASSEMENT
  if (interaction.isChatInputCommand() && interaction.commandName === 'reset-classement') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    scores.clear()
    await saveData()

    await interaction.reply({ content: '✅ Classement remis à zéro.', ephemeral: true })
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
    if (!isAdmin) return interaction.reply({ content: 'Permission refusée.', ephemeral: true })

    const list = [...matches.values()].map(m => `**${m.titre}** ${m.statut} ID: \`${m.id}\` Clôture: ${formatDateParis(m.cloture)}`).join('\n')
    await interaction.reply({ content: list || 'Aucun match.', ephemeral: true })
  }
})

client.login(TOKEN)
