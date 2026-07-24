-- posted_content.signal_id doit pouvoir être NULL : les résumés macro
-- (traffic/macro_summary.py, publiés quand aucun signal réel n'existe)
-- ne sont rattachés à aucun signal.
alter table posted_content alter column signal_id drop not null;
