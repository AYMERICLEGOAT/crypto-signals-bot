"""
Bot Discord PERSISTANT (processus séparé, à lancer avec `python discord_bot.py`) :
  - poste automatiquement le signal du jour environ une fois par 24h,
  - répond à la commande !signal à la demande dans les canaux où il est présent.

Nécessite d'activer l'intent privilégié "Message Content" pour cette
application dans le Discord Developer Portal (onglet Bot -> Privileged
Gateway Intents) — sans ça, le bot ne reçoit pas le contenu des messages et
!signal ne fonctionnera pas (voir README).

Si tu ne veux pas faire tourner de processus persistant, utilise seulement
discord_publisher.py (déjà appelé par discord_daily.py) : le message
quotidien fonctionnera, mais pas la commande !signal, qui a besoin d'une
connexion Discord active en permanence.
"""

import logging

import discord
from discord.ext import commands, tasks

from config import DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, DISCORD_COMMAND_PREFIX
from content_templates import format_discord_embed
import supabase_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

intents = discord.Intents.default()
intents.message_content = True  # nécessaire pour lire "!signal"

bot = commands.Bot(command_prefix=DISCORD_COMMAND_PREFIX, intents=intents)


def _embed_from_payload(payload):
    embed_data = payload["embeds"][0]
    embed = discord.Embed(title=embed_data["title"], color=embed_data["color"])
    for field in embed_data["fields"]:
        embed.add_field(name=field["name"], value=field["value"], inline=field.get("inline", False))
    embed.set_footer(text=embed_data["footer"]["text"])
    return payload["content"], embed


@bot.event
async def on_ready():
    logger.info("Bot Discord connecté en tant que %s.", bot.user)
    if not daily_signal_task.is_running():
        daily_signal_task.start()


@tasks.loop(hours=24)
async def daily_signal_task():
    signal = supabase_client.get_latest_signal()
    if not signal:
        return
    if signal["id"] in supabase_client.get_posted_signal_ids("discord"):
        return

    channel = bot.get_channel(int(DISCORD_CHANNEL_ID))
    if channel is None:
        logger.error("Discord: canal %s introuvable ou bot sans accès à ce canal.", DISCORD_CHANNEL_ID)
        return

    content, embed = _embed_from_payload(format_discord_embed(signal))
    await channel.send(content=content, embed=embed)
    supabase_client.record_posted("discord", signal["id"])
    logger.info("Discord (bot persistant): signal #%s publié automatiquement.", signal["id"])


@bot.command(name="signal")
async def signal_command(ctx):
    """Commande !signal : renvoie le dernier signal disponible, à la demande d'un membre."""
    signal = supabase_client.get_latest_signal()
    if not signal:
        await ctx.send("Aucun signal disponible pour le moment.")
        return

    content, embed = _embed_from_payload(format_discord_embed(signal))
    await ctx.send(content=content, embed=embed)


if __name__ == "__main__":
    if not DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN manquant dans .env")
    bot.run(DISCORD_BOT_TOKEN)
