"""
Publie (crée ou met à jour) des fichiers sur le dépôt GitHub connecté à
Cloudflare Pages, via PyGithub. Cloudflare Pages redéploie automatiquement
le site à chaque push sur la branche surveillée — rien d'autre à faire ici.
"""

from github import Github, GithubException

from config import GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, SITE_SUBDIR


def _full_path(path):
    path = path.lstrip("/")
    if SITE_SUBDIR:
        return f"{SITE_SUBDIR}/{path}"
    return path


def get_repo():
    if not GITHUB_TOKEN or not GITHUB_REPO:
        raise RuntimeError("GITHUB_TOKEN / GITHUB_REPO manquants dans .env")
    client = Github(GITHUB_TOKEN)
    return client.get_repo(GITHUB_REPO)


def upsert_file(repo, path, content, commit_message):
    """
    Crée le fichier s'il n'existe pas encore sur le dépôt, le met à jour
    sinon -- sauf si le contenu est déjà identique (Audit#11 : website.yml
    se déclenche désormais après chaque run horaire de signals.yml, la
    plupart du temps sans rien de nouveau à publier ; committer à l'identique
    à chaque fois ne faisait que polluer l'historique et déclencher un
    redéploiement Cloudflare Pages pour rien).
    """
    full_path = _full_path(path)
    try:
        existing = repo.get_contents(full_path, ref=GITHUB_BRANCH)
        if existing.decoded_content == content.encode("utf-8"):
            print(f"  Inchangé, pas de commit: {full_path}")
            return
        repo.update_file(full_path, commit_message, content, existing.sha, branch=GITHUB_BRANCH)
        print(f"  Mis à jour sur GitHub: {full_path}")
    except GithubException as exc:
        if exc.status == 404:
            repo.create_file(full_path, commit_message, content, branch=GITHUB_BRANCH)
            print(f"  Créé sur GitHub: {full_path}")
        else:
            raise


def publish_files(files):
    """`files` : liste de tuples (chemin, contenu, message_de_commit)."""
    repo = get_repo()
    for path, content, message in files:
        upsert_file(repo, path, content, message)
