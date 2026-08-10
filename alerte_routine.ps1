# Prévient l'administrateur quand la routine quotidienne échoue.
#
# POURQUOI CE FICHIER EXISTE.
#
# La routine s'est arrêtée le 03/08/2026 (limite de dépense atteinte), puis n'a
# plus jamais pu s'authentifier : « Failed to authenticate: OAuth session expired
# and could not be refreshed », SEPT jours d'affilée. La tâche planifiée se
# déclenchait pourtant chaque jour à 14:00 — elle échouait en une seconde et
# écrivait deux lignes dans un journal que personne ne lit.
#
# Sept jours de gestion quotidienne perdus sans que quiconque le sache. C'est
# exactement le même défaut que ceux corrigés dans le bot : ça échoue, ça
# journalise, personne n'est prévenu.
#
# Ce script ne répare pas l'authentification — seul un humain peut relancer une
# session OAuth. Il rend l'échec VISIBLE, ce qui est la seule chose qui manquait
# pour qu'il soit corrigé le jour même plutôt qu'une semaine plus tard.

param(
  [int]$Code = 0,
  [string]$Sortie = ""
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $MyInvocation.MyCommand.Path

# Motifs d'échec qui n'apparaissent PAS dans le code de sortie. `claude -p`
# rend parfois 0 en écrivant son erreur sur la sortie standard : se fier au seul
# code de retour laisserait passer précisément la panne qui a duré sept jours.
$motifs = @(
  "Failed to authenticate",
  "OAuth session expired",
  "spend limit",
  "Invalid API key",
  "rate limit"
)

$texteSortie = ""
if ($Sortie -and (Test-Path $Sortie)) {
  $texteSortie = (Get-Content $Sortie -Raw -ErrorAction SilentlyContinue)
}
if (-not $texteSortie) { $texteSortie = "" }

$motifTrouve = $null
foreach ($m in $motifs) {
  if ($texteSortie -match [regex]::Escape($m)) { $motifTrouve = $m; break }
}

if ($Code -eq 0 -and -not $motifTrouve) { exit 0 }

# Le jeton vit dans .dev.vars du Worker : c'est le seul endroit du dépôt qui
# le contienne, et il n'est pas versionné.
$devVars = Join-Path $racine "workers\main-worker\.dev.vars"
if (-not (Test-Path $devVars)) {
  Write-Output "ALERTE IMPOSSIBLE : .dev.vars introuvable, jeton Telegram indisponible."
  exit 1
}

$jeton = $null
$admin = "8647576528"
foreach ($ligne in Get-Content $devVars) {
  if ($ligne -match '^\s*TELEGRAM_BOT_TOKEN\s*=\s*"?([^"\r\n]+)"?\s*$') { $jeton = $Matches[1].Trim() }
  if ($ligne -match '^\s*ADMIN_TELEGRAM_ID\s*=\s*"?([^"\r\n]+)"?\s*$')  { $admin = $Matches[1].Trim() }
}
if (-not $jeton) {
  Write-Output "ALERTE IMPOSSIBLE : TELEGRAM_BOT_TOKEN absent de .dev.vars."
  exit 1
}

# Les dernières lignes suffisent : le motif d'échec y est toujours, et un
# message Telegram trop long serait refusé.
$extrait = ($texteSortie -split "`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -Last 6) -join "`n"
$raison = if ($motifTrouve) { $motifTrouve } else { "code de sortie $Code" }

$message = @"
[ROUTINE] Echec de la routine quotidienne

Motif : $raison
Date  : $(Get-Date -Format 'dd/MM/yyyy HH:mm')

$extrait

La tache planifiee se declenchera quand meme demain a 14:00 et echouera de la
meme facon tant que ce ne sera pas regle. Si c'est l'authentification :
relance `claude` dans un terminal et refais la connexion.
"@

try {
  $corps = @{ chat_id = $admin; text = $message; disable_web_page_preview = $true }
  Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$jeton/sendMessage" -Body $corps -TimeoutSec 25 | Out-Null
  Write-Output "Alerte envoyee a l'administrateur ($raison)."
} catch {
  Write-Output "ALERTE NON ENVOYEE : $($_.Exception.Message)"
  exit 1
}
