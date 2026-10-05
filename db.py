import os
import json
import sqlite3
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'qsse_wx.db')
DATABASE_URL = os.environ.get('DATABASE_URL', '')
USE_POSTGRES = bool(DATABASE_URL)

if USE_POSTGRES:
    import psycopg2

PK_AUTOINC = 'SERIAL PRIMARY KEY' if USE_POSTGRES else 'INTEGER PRIMARY KEY AUTOINCREMENT'

# Référentiel officiel des 120 indicateurs QSSE (id, domaine, sous_theme, libelle)
INDICATEURS_REF = [
    ('ENV-01','ENV','Déchets',"Taux de conformité de la gestion des déchets"),
    ('ENV-02','ENV','Déchets dangereux',"Taux d'aires de stockage de déchets dangereux conformes"),
    ('ENV-03','ENV','Traçabilité déchets',"Taux de déchets dangereux tracés jusqu'à la filière agréée"),
    ('ENV-04','ENV','Eaux usées',"Taux de dispositifs de collecte et traitement des eaux usées conformes"),
    ('ENV-05','ENV','Effluents',"Taux d'analyses d'effluents conformes aux seuils applicables"),
    ('ENV-06','ENV','Pollutions accidentelles',"Taux de déversements contenus et traités dans le délai"),
    ('ENV-07','ENV','Poussières',"Taux de réalisation du programme d'arrosage ciblé"),
    ('ENV-08','ENV','Bruit',"Taux de mesures acoustiques conformes"),
    ('ENV-09','ENV','Émissions atmosphériques',"Taux d'engins et véhicules sans émission visible anormale"),
    ('ENV-10','ENV','Hydrocarbures',"Taux de stockages d'hydrocarbures avec rétention conforme"),
    ('ENV-11','ENV','Préparation antipollution',"Taux de zones à risque équipées de kits antipollution complets"),
    ('ENV-12','ENV','Déclaration des incidents',"Taux d'incidents de pollution déclarés dans les délais"),
    ('ENV-13','ENV','Carrières et emprunts',"Taux de sites d'extraction et dépôts conformes"),
    ('ENV-14','ENV','Traçabilité des matériaux',"Taux de volumes provenant de sources autorisées"),
    ('ENV-15','ENV','Réhabilitation',"Taux de sites d'emprunt et dépôts remis en état"),

    ('QUA-01','QUAL','Laboratoire',"Taux de conformité des essais de laboratoire"),
    ('QUA-02','QUAL','Métrologie',"Taux d'équipements de laboratoire étalonnés et validés"),
    ('QUA-03','QUAL','Autocontrôles',"Taux d'exécution du programme d'autocontrôle"),
    ('QUA-04','QUAL','Non-conformités',"Taux de non-conformités avec dossier de preuve complet"),
    ('QUA-05','QUAL','Libération des lots',"Taux de lots libérés avec dossier de preuve complet"),
    ('QUA-06','QUAL','Matériaux',"Taux de matériaux d'emprunt conformes"),
    ('QUA-07','QUAL','Couche de forme',"Taux de couche de forme conformes au premier contrôle"),
    ('QUA-08','QUAL','Couche de fondation',"Taux de couche de fondation conformes"),
    ('QUA-09','QUAL','Couche de base',"Taux d'essais de compactage de couche de base conformes"),
    ('QUA-10','QUAL','Enrobés',"Taux de lots d'enrobés conformes"),
    ('QUA-11','QUAL','Traçabilité',"Taux d'échantillons entièrement traçables"),
    ('QUA-12','QUAL',"Points d'arrêt","Taux de points d'arrêt levés dans le délai"),
    ('QUA-13','QUAL','Implantation',"Taux d'implantations contrôlées avant exécution"),
    ('QUA-14','QUAL','Géométrie',"Taux de points de planéité et nivellement conformes"),
    ('QUA-15','QUAL','DOE et recollement',"Taux de pièces DOE/recollement disponibles à date"),

    ('SST-01','HSE','Accidentologie',"Taux de fréquence des accidents avec arrêt"),
    ('SST-02','HSE','Situations dangereuses',"Taux de situations dangereuses corrigées dans le délai"),
    ('SST-03','HSE','EPI',"Taux de port conforme des EPI"),
    ('SST-04','HSE','Signalisation temporaire',"Taux de dispositifs de balisage et signalisation conformes"),
    ('SST-05','HSE','Plans de circulation',"Taux de zones avec trafic couvertes par un plan validé"),
    ('SST-06','HSE','Analyse des risques',"Taux de tâches couvertes par une analyse de risques validée"),
    ('SST-07','HSE','Permis de travail',"Taux de travaux à risque avec permis conformes"),
    ('SST-08','HSE','Levage',"Taux d'opérations de levage conformes"),
    ('SST-09','HSE','Urgence et secours',"Taux de moyens d'urgence opérationnels"),
    ('SST-10','HSE','Compétences',"Taux de personnel accueilli, formé et habilité"),
    ('SST-11','HSE','Interfaces trafic',"Taux de zones en coexistence effective des flux"),
    ('SST-12','HSE','Accès secours',"Taux d'accès secours maintenus praticables"),
    ('SST-13','HSE','Coactivité',"Taux de situations de coactivité maîtrisées"),
    ('SST-14','HSE','Fin de poste',"Taux de zones laissées propres et sécurisées"),
    ('SST-15','HSE','Ouverture de zone',"Taux d'ouvertures de zone formellement autorisées"),

    ('TOP-01','TOPO','Implantation',"Taux d'implantations contrôlées avant exécution"),
    ('TOP-02','TOPO','Réimplantation',"Taux de recalages acceptés au premier contrôle"),
    ('TOP-03','TOPO','Altimétrie',"Taux de points altimétriques conformes"),
    ('TOP-04','TOPO','Planimétrie',"Taux de points planimétriques conformes"),
    ('TOP-05','TOPO','Planéité et nivellement',"Taux de sections de chaussée conformes en planéité/nivellement"),
    ('TOP-06','TOPO','Drainage',"Taux de tronçons de fossés conformes en profil et pente"),
    ('TOP-07','TOPO','Implantation OA',"Taux d'ouvrages hydrauliques/OA implantés conformes"),
    ('TOP-08','TOPO','Recollement courant',"Taux de levés de recollement disponibles à date"),
    ('TOP-09','TOPO','Contrôle préalable',"Taux de bétonnages/couches contrôlés avant exécution"),
    ('TOP-10','TOPO','Profil en long',"Taux de profils en long conformes"),
    ('TOP-11','TOPO','Profil en travers',"Taux de points de référence disponibles et sécurisés"),
    ('TOP-12','TOPO','Canevas',"Taux de repères disponibles et sécurisés"),
    ('TOP-13','TOPO','Cubatures',"Taux de cubatures contrôlées/validées"),
    ('TOP-14','TOPO','Levés contradictoires',"Taux d'écarts contradictoires résolus dans le délai"),
    ('TOP-15','TOPO','Recollement final',"Taux de levés de recollement final validé"),

    ('SOC-01','SOC','Conformité RH',"Taux de travailleurs disposant d'un contrat écrit conforme"),
    ('SOC-02','SOC','Protection sociale',"Taux de travailleurs déclarés à la CSS et à l'IPRES"),
    ('SOC-03','SOC','Conditions de travail et base-vie',"Taux de critères sociaux et d'hébergement conformes"),
    ('SOC-04','SOC','Sous-traitance',"Taux de sous-traitants intégrés au dispositif social QSSE"),
    ('SOC-05','SOC','Emploi local',"Taux d'emploi local"),
    ('SOC-06','SOC','Mécanisme de gestion des plaintes',"Taux de comités locaux de gestion des plaintes opérationnels"),
    ('SOC-07','SOC','Plaintes — enregistrement',"Taux de plaintes enregistrées et accusées dans les 48h"),
    ('SOC-08','SOC','Plaintes — traitement',"Taux de plaintes clôturées dans le délai prescrit"),
    ('SOC-09','SOC','Plaintes — retour au plaignant',"Taux de plaintes clôturées avec preuve de retour"),
    ('SOC-10','SOC','Libération des emprises',"Taux de dossiers de PAP finalisés"),
    ('SOC-11','SOC','Conciliation',"Taux de PAP passées en commission de conciliation"),
    ('SOC-12','SOC','Indemnisation',"Taux de PAP indemnisées avant occupation de l'emprise"),
    ('SOC-13','SOC','Réinstallation',"Taux de ménages réinstallés dans des conditions conformes avant déplacement"),
    ('SOC-14','SOC','Information et consultation',"Taux de réunions communautaires planifiées effectivement tenues"),
    ('SOC-15','SOC','Accès et mobilité',"Taux d'accès provisoires riverains fonctionnels et sécurisés"),

    ('OA-01','OA',"Points d'arrêt","Taux de points d'arrêt levés dans le délai"),
    ('OA-02','OA','Implantation',"Taux d'implantations contrôlées avant exécution"),
    ('OA-03','OA','Couche de substitution et fondations',"Taux de fondations contrôlées avant bétonnage"),
    ('OA-04','OA','Ferraillage',"Taux de ferraillages contrôlés avant bétonnage"),
    ('OA-05','OA','Coffrage et géométrie',"Taux de coffrages et géométries conformes"),
    ('OA-06','OA','Bétonnage',"Taux de gâchées de béton conformes à la mise en œuvre"),
    ('OA-07','OA','Résistance du béton',"Taux d'essais de résistance à 28 jours conformes"),
    ('OA-08','OA','Cure et décoffrage',"Taux d'éléments respectant le protocole de cure et de décoffrage"),
    ('OA-09','OA','Poutres et préfabriqués',"Taux d'opérations de transport et pose conformes"),
    ('OA-10','OA',"Appareils d'appui","Taux d'appareils d'appui réceptionnés et posés conformes"),
    ('OA-11','OA','Tablier et dalles',"Taux de dalles/tabliers conformes au premier contrôle"),
    ('OA-12','OA','Étanchéité et drainage',"Taux de surfaces d'étanchéité et dispositifs de drainage conformes"),
    ('OA-13','OA','Joints de chaussée',"Taux de joints de chaussée conformes"),
    ('OA-14','OA','Accès et transition',"Taux de remblais d'accès et dalles de transition conformes"),
    ('OA-15','OA','Non-conformités',"Taux de non-conformités OA clôturées dans le délai"),

    ('GC-01','GC','Terrassements',"Taux d'avancement des terrassements"),
    ('GC-02','GC','Assainissement',"Taux d'avancement du drainage et de l'assainissement"),
    ('GC-03','GC','Couches de chaussée',"Taux d'avancement des couches de forme, fondation et base"),
    ('GC-04','GC','Revêtement bitumineux',"Taux d'avancement des revêtements bitumineux"),
    ('GC-05','GC','Pilotage production',"Taux de réalisation globale du programme hebdomadaire"),
    ('GC-06','GC','Préavis',"Taux de fronts ouverts avec tous les préavis levés"),
    ('GC-07','GC','Terrassements',"Taux de lots de terrassement conformes au premier contrôle"),
    ('GC-08','GC','Matériaux',"Taux de sources et matériaux agréés avant emploi"),
    ('GC-09','GC','Compactage',"Taux de lots de compactage conformes"),
    ('GC-10','GC','Géométrie',"Taux de contrôles géométriques et altimétriques conformes"),
    ('GC-11','GC','Assainissement',"Taux de tronçons d'assainissement conformes au premier contrôle"),
    ('GC-12','GC','Enrobés',"Taux de lots d'enrobés conformes"),
    ('GC-13','GC','Reprises techniques',"Taux de travaux acceptés sans reprise"),
    ('GC-14','GC',"Points d'arrêt","Taux de points d'arrêt levés dans le délai"),
    ('GC-15','GC','Finitions et libération',"Taux de sections achevées réceptionnées et sécurisées"),

    ('GEO-01','GEO',"Études d'exécution","Taux d'études géotechniques approuvées avant travaux"),
    ('GEO-02','GEO',"Matériaux d'emprunt","Taux de lots de matériaux d'emprunt agréés"),
    ('GEO-03','GEO','Essais Proctor',"Taux d'essais Proctor validés avant mise en œuvre"),
    ('GEO-04','GEO','Densité en place',"Taux de densité en place conformes"),
    ('GEO-05','GEO','Portance in situ',"Taux de portance in situ conformes"),
    ('GEO-06','GEO',"Programme d'essais","Taux d'exécution du programme d'essais géotechniques"),
    ('GEO-07','GEO','Résultats du laboratoire',"Taux de résultats de laboratoire validés dans le délai"),
    ('GEO-08','GEO','Validations des couches',"Taux de couches validées avant recouvrement"),
    ('GEO-09','GEO','Non-conformités',"Taux de non-conformités géotechniques traitées dans le délai"),
    ('GEO-10','GEO','Traçabilité des sources',"Taux de matériaux entièrement tracés jusqu'à la source"),
    ('GEO-11','GEO','Conformité aux exigences',"Taux de couches conformes au premier contrôle"),
    ('GEO-12','GEO','Réaction aux essais non conformes',"Taux d'essais non conformes avec action corrective déclenchée"),
    ('GEO-13','GEO','Reprises',"Taux de reprises géotechniques acceptées sans recontrôle"),
    ('GEO-14','GEO','Validations',"Taux de zones géotechniques validées avant exécution dans les zones sensibles"),
    ('GEO-15','GEO','Zones sensibles',"Taux de zones géotechniques sensibles sous surveillance renforcée"),
]


class Row(dict):
    """dict that also supports positional access, like sqlite3.Row (row[0])."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return dict.__getitem__(self, key)


def _row_from_cursor(cur, raw):
    if raw is None:
        return None
    cols = [d[0] for d in cur.description]
    return Row(zip(cols, raw))


class PGCursor:
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=()):
        self._cur.execute(sql.replace('?', '%s'), params)
        return self

    def executemany(self, sql, seq):
        self._cur.executemany(sql.replace('?', '%s'), list(seq))
        return self

    def executescript(self, sql):
        self._cur.execute(sql)
        return self

    def fetchone(self):
        return _row_from_cursor(self._cur, self._cur.fetchone())

    def fetchall(self):
        rows = self._cur.fetchall()
        return [_row_from_cursor(self._cur, r) for r in rows]

    @property
    def rowcount(self):
        return self._cur.rowcount


class PGConn:
    def __init__(self, raw):
        self._raw = raw

    def cursor(self):
        return PGCursor(self._raw.cursor())

    def execute(self, sql, params=()):
        return self.cursor().execute(sql, params)

    def executemany(self, sql, seq):
        return self.cursor().executemany(sql, seq)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def get_conn():
    if USE_POSTGRES:
        raw = psycopg2.connect(DATABASE_URL)
        return PGConn(raw)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _add_col(c, table, col, defn):
    if USE_POSTGRES:
        c.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {defn}')
        return
    try:
        c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {defn}')
    except sqlite3.OperationalError:
        pass


def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.executescript(f'''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            prenom TEXT NOT NULL,
            nom TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            domaine TEXT DEFAULT '',
            actif INTEGER DEFAULT 1,
            password_hash TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#185FA5',
            derniere_cnx TEXT
        );
        CREATE TABLE IF NOT EXISTS indicateurs (
            id TEXT PRIMARY KEY,
            domaine TEXT NOT NULL,
            zone TEXT NOT NULL,
            libelle TEXT NOT NULL,
            bloquant INTEGER DEFAULT 0,
            reglementaire INTEGER DEFAULT 0,
            statut TEXT DEFAULT 'conforme',
            score REAL,
            points_risque INTEGER DEFAULT 0,
            rang INTEGER,
            impact TEXT DEFAULT 'Moyen',
            poids REAL DEFAULT 1.0
        );
        CREATE TABLE IF NOT EXISTS observations (
            id {PK_AUTOINC},
            indicateur_id TEXT NOT NULL,
            date TEXT NOT NULL,
            statut TEXT NOT NULL,
            score REAL,
            observateur TEXT NOT NULL,
            commentaire TEXT DEFAULT '',
            FOREIGN KEY (indicateur_id) REFERENCES indicateurs(id)
        );
        CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY,
            source_id TEXT DEFAULT '',
            libelle TEXT NOT NULL,
            domaine TEXT NOT NULL,
            responsable TEXT NOT NULL,
            delai TEXT NOT NULL,
            avancement INTEGER DEFAULT 0,
            statut TEXT DEFAULT 'ouverte',
            priorite TEXT DEFAULT 'majeure',
            date_creation TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            zone TEXT NOT NULL,
            type TEXT NOT NULL,
            gravite TEXT NOT NULL,
            jours_arret INTEGER DEFAULT 0,
            description TEXT NOT NULL,
            cause TEXT DEFAULT 'En investigation',
            responsable TEXT NOT NULL,
            statut TEXT DEFAULT 'ouvert'
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id {PK_AUTOINC},
            niveau TEXT NOT NULL,
            titre TEXT NOT NULL,
            message TEXT NOT NULL,
            time_label TEXT NOT NULL,
            lue INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS revue_history (
            id {PK_AUTOINC},
            date TEXT NOT NULL,
            score_8d REAL,
            indice REAL,
            risque REAL,
            feu TEXT,
            decision TEXT,
            validateur TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            cle TEXT PRIMARY KEY,
            valeur TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS action_reviews (
            id {PK_AUTOINC},
            action_id TEXT NOT NULL,
            date TEXT NOT NULL,
            statut TEXT NOT NULL,
            avancement INTEGER DEFAULT 0,
            commentaire TEXT DEFAULT '',
            reviewer TEXT NOT NULL,
            FOREIGN KEY (action_id) REFERENCES actions(id)
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id {PK_AUTOINC},
            timestamp TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            details TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS tf_tg_history (
            id {PK_AUTOINC},
            mois TEXT NOT NULL,
            annee INTEGER NOT NULL,
            heures_travaillees INTEGER DEFAULT 0,
            nb_accidents INTEGER DEFAULT 0,
            jours_arret INTEGER DEFAULT 0,
            tf REAL DEFAULT 0.0,
            tg REAL DEFAULT 0.0
        );
        CREATE TABLE IF NOT EXISTS report_history (
            id {PK_AUTOINC},
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            filename TEXT NOT NULL,
            generated_by TEXT NOT NULL,
            generated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS indicateur_history (
            id {PK_AUTOINC},
            ind_id TEXT NOT NULL,
            date TEXT NOT NULL,
            action TEXT NOT NULL,
            ancien_statut TEXT,
            nouveau_statut TEXT,
            ancien_score REAL,
            nouveau_score REAL,
            modif_par TEXT NOT NULL,
            details TEXT DEFAULT ''
        );
    ''')

    # Schema migration: add new columns if they don't exist yet
    _add_col(c, 'indicateurs', 'categorie', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'sous_theme', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'exposition', "TEXT DEFAULT 'continue'")
    _add_col(c, 'indicateurs', 'transversalite', "INTEGER DEFAULT 0")
    _add_col(c, 'indicateurs', 'poids_actif', "REAL DEFAULT 0.0")
    _add_col(c, 'indicateurs', 'indice_priorite', "REAL DEFAULT 0.0")
    _add_col(c, 'indicateurs', 'rang_priorite', "INTEGER")
    _add_col(c, 'indicateurs', 'priorite_action', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'delai_cible', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'action_standard', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'responsable_defaut', "TEXT DEFAULT ''")
    _add_col(c, 'indicateurs', 'perte_ponderee', "REAL DEFAULT 0.0")
    _add_col(c, 'actions', 'prochaine_revue', "TEXT DEFAULT ''")
    _add_col(c, 'actions', 'commentaire_pilote', "TEXT DEFAULT ''")
    _add_col(c, 'incidents', 'action_immediate', "TEXT DEFAULT ''")
    _add_col(c, 'users', 'photo_url', "TEXT DEFAULT NULL")
    _add_col(c, 'observations', 'photos', "TEXT DEFAULT '[]'")
    _add_col(c, 'incidents', 'photos', "TEXT DEFAULT '[]'")
    _add_col(c, 'incidents', 'date_cloture', "TEXT DEFAULT NULL")
    _add_col(c, 'incidents', 'cloture_par', "TEXT DEFAULT NULL")
    _add_col(c, 'indicateurs', 'seuil_alerte', "REAL DEFAULT NULL")
    _add_col(c, 'users', 'reset_token_hash', "TEXT DEFAULT NULL")
    _add_col(c, 'users', 'reset_token_expires', "TEXT DEFAULT NULL")

    if not c.execute('SELECT COUNT(*) FROM users').fetchone()[0]:
        _seed(c)

    if not c.execute('SELECT COUNT(*) FROM tf_tg_history').fetchone()[0]:
        _seed_tftg(c)

    conn.commit()
    conn.close()


def _seed(c):
    pwd = generate_password_hash('admin1234')
    users = [
        ('u1','Jean','Diallo','j.diallo@chantier.fr','resp_qsse','',1,pwd,'#185FA5','2025-05-01 08:14'),
        ('u2','Marie','Koné','m.kone@chantier.fr','direction','',1,pwd,'#7b3fa0','2025-04-30 17:02'),
        ('u3','Ahmed','Dupont','a.dupont@chantier.fr','chef_chantier','',1,pwd,'#BA7517','2025-05-01 07:55'),
        ('u4','Samba','Martin','s.martin@chantier.fr','resp_domaine','HSE',1,pwd,'#A32D2D','2025-05-01 09:30'),
        ('u5','Fatou','Traoré','f.traore@chantier.fr','resp_domaine','QUAL',1,pwd,'#177a6a','2025-04-29 14:20'),
        ('u6','Luc','Sy','l.sy@chantier.fr','metier','GC',1,pwd,'#3B6D11','2025-04-28 11:45'),
        ('u7','Admin','Système','admin@chantier.fr','admin','',1,pwd,'#6b7591','2025-04-25 10:00'),
        ('u8','René','Koné','r.kone@chantier.fr','direction','',0,pwd,'#854F0B','2025-04-10 15:33'),
    ]
    c.executemany('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)', users)

    # Référentiel officiel des 120 indicateurs QSSE — statut 'na' (non encore évalué), à alimenter via Saisie terrain
    indicateurs = [
        (ref_id, domaine, '', libelle, 0, 0, 'na', None, 0, None, 'Moyen', 1.0)
        for ref_id, domaine, _sous_theme, libelle in INDICATEURS_REF
    ]
    c.executemany('INSERT INTO indicateurs (id,domaine,zone,libelle,bloquant,reglementaire,statut,score,points_risque,rang,impact,poids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', indicateurs)
    c.executemany(
        'UPDATE indicateurs SET sous_theme=? WHERE id=?',
        [(sous_theme, ref_id) for ref_id, _domaine, sous_theme, _libelle in INDICATEURS_REF]
    )

    incidents = [
        ('INC-001','2025-04-29','Zone B','HSE','grave',3,'Chute de hauteur — échafaudage','Défaut harnais','S. Martin','investigation'),
        ('INC-002','2025-04-27','Zone A','Qualité','mineur',0,'NC bétonnage coulisse','Dosage incorrect','M. Diallo','cloture'),
        ('INC-003','2025-04-25','Zone D','Env.','modere',0,'Déversement huile 50L','Fuite engin TP','A. Dupont','en_cours'),
        ('INC-004','2025-04-22','Zone C','GC','mineur',0,'Défaut compactage couche 2','Humidité excessive','R. Koné','cloture'),
        ('INC-005','2025-04-18','Zone A','OA','modere',1,'Fissuration poutre P2','Défaut coffrage','F. Traoré','en_cours'),
    ]
    c.executemany('INSERT INTO incidents (id,date,zone,type,gravite,jours_arret,description,cause,responsable,statut) VALUES (?,?,?,?,?,?,?,?,?,?)', incidents)

    notifs = [
        ('info','Référentiel QSSE initialisé','120 indicateurs chargés — à évaluer via Saisie terrain','maintenant',0),
    ]
    c.executemany('INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)', notifs)

    default_settings = [
        ('revue_scores', json.dumps({'perf':78,'risque':66,'crit':41,'cloture':52,'arb':55})),
        ('seuils', json.dumps({'vert':85,'orange':70,'rouge':55})),
        ('poids_8d', json.dumps({'perf':30,'risque':25,'crit':20,'cloture':15,'arb':10})),
        ('chantier', json.dumps({'taux_cloture_cible':80,'heures_trav_mois':10000})),
        ('baremes', json.dumps({'conforme':1.0,'nc_mineure':0.75,'nc_majeure':0.5,'nc_critique':0.0})),
    ]
    c.executemany(
        'INSERT INTO settings (cle,valeur) VALUES (?,?) ON CONFLICT (cle) DO UPDATE SET valeur=excluded.valeur',
        default_settings)


def _seed_tftg(c):
    data = [
        ('Novembre', 2024, 9800,  0, 0, 0.0,   0.0),
        ('Décembre', 2024, 10200, 1, 2, 98.0,  0.196),
        ('Janvier',  2025, 9500,  0, 0, 0.0,   0.0),
        ('Février',  2025, 10100, 1, 1, 99.0,  0.099),
        ('Mars',     2025, 10300, 0, 0, 0.0,   0.0),
        ('Avril',    2025, 10000, 1, 3, 100.0, 0.3),
    ]
    c.executemany(
        'INSERT INTO tf_tg_history (mois,annee,heures_travaillees,nb_accidents,jours_arret,tf,tg) VALUES (?,?,?,?,?,?,?)',
        data)
