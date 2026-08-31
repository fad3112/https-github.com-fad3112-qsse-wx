import sqlite3
import os
import json
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'qsse_wx.db')


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _add_col(c, table, col, defn):
    try:
        c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {defn}')
    except Exception:
        pass


def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.executescript('''
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            niveau TEXT NOT NULL,
            titre TEXT NOT NULL,
            message TEXT NOT NULL,
            time_label TEXT NOT NULL,
            lue INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS revue_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_id TEXT NOT NULL,
            date TEXT NOT NULL,
            statut TEXT NOT NULL,
            avancement INTEGER DEFAULT 0,
            commentaire TEXT DEFAULT '',
            reviewer TEXT NOT NULL,
            FOREIGN KEY (action_id) REFERENCES actions(id)
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            details TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS tf_tg_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mois TEXT NOT NULL,
            annee INTEGER NOT NULL,
            heures_travaillees INTEGER DEFAULT 0,
            nb_accidents INTEGER DEFAULT 0,
            jours_arret INTEGER DEFAULT 0,
            tf REAL DEFAULT 0.0,
            tg REAL DEFAULT 0.0
        );
        CREATE TABLE IF NOT EXISTS report_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            filename TEXT NOT NULL,
            generated_by TEXT NOT NULL,
            generated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS indicateur_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    # id, domaine, zone, libelle, bloquant, reglementaire, statut, score, points_risque, rang, impact, poids
    indicateurs = [
        ('HSE-01','HSE','Zone B','Port EPI obligatoire',1,1,'nc_critique',0.0,3,1,'Élevé',3.0),
        ('OA-07','OA','Zone A','Contrôle ferraillage P3',1,1,'nc_critique',0.0,3,2,'Élevé',3.5),
        ('HSE-04','HSE','Zone B','Plan de prévention à jour',0,1,'nc_majeure',0.5,2,3,'Élevé',2.5),
        ('ENV-02','ENV','Zone D','Gestion déchets liquides',0,1,'nc_majeure',0.5,2,4,'Moyen',2.0),
        ('QUA-03','QUAL','Zone A','Bétonnage conforme DOS',1,0,'nc_mineure',0.75,1,5,'Élevé',2.0),
        ('GC-05','GC','Zone C','Compactage couche 2',0,0,'nc_mineure',0.75,1,6,'Moyen',1.5),
        ('WX-01','WX','Zone A','Suivi vents critiques',1,0,'nc_mineure',0.75,1,7,'Élevé',2.0),
        ('HSE-12','HSE','Zone A','Formation secouristes à jour',0,1,'nc_mineure',0.75,1,8,'Élevé',1.5),
        ('TOPO-01','TOPO','Zone A','Implantation axes OK',0,0,'conforme',1.0,0,None,'Élevé',2.0),
        ('GEO-02','GEO','Zone C','Essais pressiométriques',0,0,'conforme',1.0,0,None,'Moyen',1.5),
        ('QUAL-01','QUAL','Zone B','Plan qualité validé',0,0,'conforme',1.0,0,None,'Élevé',2.0),
        ('GC-01','GC','Zone A','Compactage couche 1',0,0,'conforme',1.0,0,None,'Moyen',1.5),
        ('OA-01','OA','Zone A',"Plans d'exécution approuvés",0,0,'conforme',1.0,0,None,'Élevé',2.5),
        ('HSE-02','HSE','Zone A','Balisage chantier conforme',0,1,'conforme',1.0,0,None,'Moyen',1.5),
        ('HSE-03','HSE','Zone D','Registre médical à jour',0,1,'na',None,0,None,'Moyen',1.5),
        ('WX-03','WX','Zone D','Protocole gel/verglas',0,0,'na',None,0,None,'Moyen',1.0),
    ]
    c.executemany('INSERT INTO indicateurs (id,domaine,zone,libelle,bloquant,reglementaire,statut,score,points_risque,rang,impact,poids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', indicateurs)

    observations = [
        ('HSE-01','25/04/25','nc_critique',0.0,'M. Diallo','Harnais non homologués Zone B'),
        ('HSE-01','18/04/25','nc_critique',0.0,'S. Martin','3 agents sans harnais'),
        ('HSE-01','11/04/25','nc_mineure',0.75,'R. Koné','1 harnais périmé'),
        ('HSE-01','04/04/25','conforme',1.0,'M. Diallo',''),
        ('HSE-01','28/03/25','conforme',1.0,'S. Martin',''),
        ('OA-07','24/04/25','nc_critique',0.0,'F. Traoré','Ferraillage non conforme pylône P3'),
        ('OA-07','17/04/25','nc_majeure',0.5,'M. Diallo','Diamètre insuffisant'),
        ('OA-07','10/04/25','conforme',1.0,'F. Traoré',''),
        ('OA-07','03/04/25','conforme',1.0,'M. Diallo',''),
    ]
    c.executemany(
        'INSERT INTO observations (indicateur_id,date,statut,score,observateur,commentaire) VALUES (?,?,?,?,?,?)',
        observations)

    actions = [
        ('ACT-001','HSE-01','Remplacement harnais non conformes Zone B','HSE','S. Martin','2025-05-01',30,'ouverte','critique','2025-04-29'),
        ('ACT-002','OA-07','Contrôle bétonnage coffrage pylône P3','OA','M. Diallo','2025-05-03',45,'en_cours','critique','2025-04-29'),
        ('ACT-003','HSE-04','Mise à jour plan prévention section C','HSE','R. Koné','2025-05-05',80,'en_cours','majeure','2025-04-25'),
        ('ACT-004','ENV-02','Bacs de rétention Zone D','ENV','A. Dupont','2025-05-07',60,'en_cours','majeure','2025-04-25'),
        ('ACT-005','QUA-03','Vérification dosage béton','QUAL','F. Traoré','2025-05-10',20,'ouverte','mineure','2025-04-25'),
        ('ACT-006','GC-05','Essais Proctor section B','GC','L. Sy','2025-05-12',10,'ouverte','mineure','2025-04-25'),
        ('ACT-007','HSE-09','Renouvellement permis de feu Zone C','HSE','S. Martin','2025-04-28',0,'ouverte','majeure','2025-04-20'),
        ('ACT-008','WX-01','Protocole arrêt vents >60 km/h','WX','D. Ndiaye','2025-04-25',0,'ouverte','critique','2025-04-20'),
    ]
    c.executemany('INSERT INTO actions (id,source_id,libelle,domaine,responsable,delai,avancement,statut,priorite,date_creation) VALUES (?,?,?,?,?,?,?,?,?,?)', actions)

    incidents = [
        ('INC-001','2025-04-29','Zone B','HSE','grave',3,'Chute de hauteur — échafaudage','Défaut harnais','S. Martin','investigation'),
        ('INC-002','2025-04-27','Zone A','Qualité','mineur',0,'NC bétonnage coulisse','Dosage incorrect','M. Diallo','cloture'),
        ('INC-003','2025-04-25','Zone D','Env.','modere',0,'Déversement huile 50L','Fuite engin TP','A. Dupont','en_cours'),
        ('INC-004','2025-04-22','Zone C','GC','mineur',0,'Défaut compactage couche 2','Humidité excessive','R. Koné','cloture'),
        ('INC-005','2025-04-18','Zone A','OA','modere',1,'Fissuration poutre P2','Défaut coffrage','F. Traoré','en_cours'),
    ]
    c.executemany('INSERT INTO incidents (id,date,zone,type,gravite,jours_arret,description,cause,responsable,statut) VALUES (?,?,?,?,?,?,?,?,?,?)', incidents)

    notifs = [
        ('danger','NC critique bloquante — HSE-01','Port EPI · Zone B · J+0','il y a 2h',0),
        ('danger','Score 8D = 61.2 — Seuil alerte atteint','Intervention immédiate requise','il y a 4h',0),
        ('warning','7 actions en retard détectées','Revue avec responsables requise','ce matin 8h',0),
        ('info','Revue hebdomadaire envoyée','Semaine 17 — direction + QSSE','ven. 16h',1),
        ('warning','Incident grave déclaré — Zone B','Chute de hauteur · 3 jours arrêt','29/04',1),
    ]
    c.executemany('INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)', notifs)

    revue_hist = [
        ('30/04/2025',61.2,78.4,34,'rouge','STOP — Intervention immédiate','J. Diallo'),
        ('23/04/2025',66.1,80.2,28,'orange','Alerte — Plan renforcé 48h','J. Diallo'),
        ('16/04/2025',71.8,83.5,21,'vert','Poursuite normale','J. Diallo'),
    ]
    c.executemany(
        'INSERT INTO revue_history (date,score_8d,indice,risque,feu,decision,validateur) VALUES (?,?,?,?,?,?,?)',
        revue_hist)

    default_settings = [
        ('revue_scores', json.dumps({'perf':78,'risque':66,'crit':41,'cloture':52,'arb':55})),
        ('seuils', json.dumps({'vert':85,'orange':70,'rouge':55})),
        ('poids_8d', json.dumps({'perf':30,'risque':25,'crit':20,'cloture':15,'arb':10})),
        ('chantier', json.dumps({'taux_cloture_cible':80,'heures_trav_mois':10000})),
        ('baremes', json.dumps({'conforme':1.0,'nc_mineure':0.75,'nc_majeure':0.5,'nc_critique':0.0})),
    ]
    c.executemany('INSERT OR REPLACE INTO settings VALUES (?,?)', default_settings)


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
