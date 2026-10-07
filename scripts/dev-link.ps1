<#
.SYNOPSIS
    Installe Sonar.plugin.js dans le dossier plugins de BetterDiscord.

.DESCRIPTION
    Par defaut, cree un lien symbolique : BetterDiscord surveille le dossier plugins
    et recharge le plugin a chaque sauvegarde du fichier source, ce qui donne du
    hot-reload gratuit pendant le developpement.

    Un lien symbolique necessite le mode developpeur Windows ou des droits
    administrateur. A defaut, utiliser -Copy pour une simple copie (il faudra
    relancer le script apres chaque modification).

.EXAMPLE
    .\scripts\dev-link.ps1
    .\scripts\dev-link.ps1 -Copy
    .\scripts\dev-link.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch]$Copy,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'Sonar.plugin.js'
$pluginDir = Join-Path $env:APPDATA 'BetterDiscord\plugins'
$target = Join-Path $pluginDir 'Sonar.plugin.js'

if (-not (Test-Path $source)) {
    throw "Fichier source introuvable : $source"
}

if (-not (Test-Path $pluginDir)) {
    throw "Dossier plugins BetterDiscord introuvable : $pluginDir`nBetterDiscord est-il installe ?"
}

if ($Remove) {
    if (Test-Path $target) {
        Remove-Item $target -Force
        Write-Host "Supprime : $target" -ForegroundColor Yellow
    } else {
        Write-Host "Rien a supprimer." -ForegroundColor Yellow
    }
    return
}

if ($Copy) {
    if (Test-Path $target) { Remove-Item $target -Force }
    Copy-Item $source $target -Force
    Write-Host "Copie     : $target" -ForegroundColor Green
    Write-Host "Relancer ce script apres chaque modification du source." -ForegroundColor DarkGray
    return
}

# Le lien est d'abord cree a cote, puis substitue : si la creation echoue,
# l'installation existante reste intacte au lieu d'etre supprimee.
$tmp = "$target.tmp"
try {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    New-Item -ItemType SymbolicLink -Path $tmp -Target $source | Out-Null
    if (Test-Path $target) { Remove-Item $target -Force }
    Rename-Item $tmp (Split-Path $target -Leaf)
    Write-Host "Lien cree : $target" -ForegroundColor Green
    Write-Host "         -> $source" -ForegroundColor DarkGray
    Write-Host "BetterDiscord rechargera le plugin a chaque sauvegarde du source." -ForegroundColor DarkGray
} catch {
    Write-Host "Creation du lien symbolique impossible : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Activer le mode developpeur Windows (Parametres > Confidentialite et securite >" -ForegroundColor Yellow
    Write-Host "Pour les developpeurs), lancer PowerShell en administrateur, ou utiliser -Copy." -ForegroundColor Yellow
    exit 1
}
