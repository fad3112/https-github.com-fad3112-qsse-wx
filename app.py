import json
import os
import uuid
import functools
import secrets
import hashlib
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, session, render_template, redirect, url_for, send_from_directory, Response
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
import db

app = Flask(__name__)
app.secret_key = os.environ.get('QSSE_SECRET_KEY', 'qsse-wx-a89-chantier-secret-2025')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)
app.config['SESSION_PERMANENT'] = True
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5 Mo max par upload
CORS(app, supports_credentials=True, origins=['http://localhost:5000', 'http://127.0.0.1:5000'])

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
ALLOWED_IMG = {'jpg', 'jpeg', 'png', 'webp', 'gif'}
os.makedirs(os.path.join(UPLOAD_FOLDER, 'avatars'), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_FOLDER, 'site'), exist_ok=True)

# ── SMTP (récupération de mot de passe) ───────────────────────────
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_FROM = os.environ.get('SMTP_FROM', SMTP_USER)
APP_BASE_URL = os.environ.get('APP_BASE_URL', 'http://127.0.0.1:5000')
RESET_TOKEN_TTL_MIN = 60


def send_reset_email(to_email, to_name, reset_link):
    subject = 'QSSE-Wx — Réinitialisation de votre mot de passe'
    body = (
        f'Bonjour {to_name},\n\n'
        f'Une demande de réinitialisation de mot de passe a été effectuée pour votre compte QSSE-Wx.\n'
        f'Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe (valable {RESET_TOKEN_TTL_MIN} minutes) :\n\n'
        f'{reset_link}\n\n'
        f"Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\n"
        f'— QSSE-Wx, AGEROUTE Sénégal'
    )
    if not SMTP_HOST:
        # Pas de SMTP configuré : on journalise le lien pour ne pas bloquer les tests locaux
        app.logger.warning('SMTP non configuré — lien de réinitialisation pour %s : %s', to_email, reset_link)
        return
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = SMTP_FROM
    msg['To'] = to_email
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
        smtp.starttls()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(msg)


def _allowed_img(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_IMG

db.init_db()

# Run initial recalculation so computed fields are populated from the start
_startup_conn = db.get_conn()
try:
    from db import get_conn as _gc
    _rows = _startup_conn.execute('SELECT COUNT(*) FROM indicateurs WHERE poids_actif > 0').fetchone()[0]
    if _rows == 0:
        _inds = _startup_conn.execute('SELECT * FROM indicateurs').fetchall()
        _active = [r for r in _inds if r['statut'] != 'na' and r['score'] is not None]
        _tp = sum(float(r['poids']) for r in _active) or 1.0
        for r in _inds:
            if r['statut'] == 'na' or r['score'] is None:
                pa, pp, ip = 0.0, 0.0, 0.0
            else:
                pa = float(r['poids']) / _tp
                pp = round((1.0 - float(r['score'])) * pa, 4)
                ip = float(r['points_risque']) * (2 if r['bloquant'] else 1) * (2 if r['reglementaire'] else 1)
                pp = round(pp, 4); pa = round(pa, 4)
            _startup_conn.execute(
                'UPDATE indicateurs SET poids_actif=?,perte_ponderee=?,indice_priorite=? WHERE id=?',
                (pa, pp, ip, r['id']))
        _rankable = sorted(
            [(r['id'], float(r['poids'])/_tp * float(r['points_risque']) *
              (2 if r['bloquant'] else 1) * (2 if r['reglementaire'] else 1),
              float(r['score'] or 1.0))
             for r in _inds if r['statut'] != 'na' and r['score'] is not None],
            key=lambda x: (-x[1], x[2]))
        for _rank, (_id, _, _) in enumerate(_rankable, 1):
            _startup_conn.execute('UPDATE indicateurs SET rang_priorite=? WHERE id=?', (_rank, _id))
        _startup_conn.commit()
finally:
    _startup_conn.close()

ROLE_LABELS = {
    'admin': 'Administrateur', 'direction': 'Direction',
    'resp_qsse': 'Resp. QSSE', 'chef_chantier': 'Chef chantier',
    'resp_domaine': 'Resp. domaine', 'metier': 'Métier',
}


def login_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Non autorisé'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return wrapper


# ── CALCULATION ENGINE ────────────────────────────────────────────

def recalc_indicators(conn):
    """Recompute poids_actif, indice_priorite, rang_priorite, perte_ponderee for all indicators."""
    rows = conn.execute('SELECT * FROM indicateurs').fetchall()
    active = [r for r in rows if r['statut'] != 'na' and r['score'] is not None]
    total_poids = sum(float(r['poids']) for r in active) or 1.0

    updates = []
    for r in rows:
        if r['statut'] == 'na' or r['score'] is None:
            pa = 0.0
            pp = 0.0
            ip = 0.0
        else:
            pa = float(r['poids']) / total_poids
            pp = round((1.0 - float(r['score'])) * pa, 4)
            bl_mult = 2 if r['bloquant'] else 1
            rg_mult = 2 if r['reglementaire'] else 1
            ip = float(r['points_risque']) * bl_mult * rg_mult
        updates.append((round(pa, 4), pp, ip, r['id']))

    conn.executemany(
        'UPDATE indicateurs SET poids_actif=?, perte_ponderee=?, indice_priorite=? WHERE id=?',
        updates
    )

    rankable = sorted(
        [(r['id'],
          float(r['poids']) / total_poids * float(r['points_risque']) *
          (2 if r['bloquant'] else 1) * (2 if r['reglementaire'] else 1),
          float(r['score'] or 1.0))
         for r in rows if r['statut'] != 'na' and r['score'] is not None],
        key=lambda x: (-x[1], x[2])
    )
    for rank, (ind_id, _, _) in enumerate(rankable, 1):
        conn.execute('UPDATE indicateurs SET rang_priorite=? WHERE id=?', (rank, ind_id))
    for r in rows:
        if r['statut'] == 'na' or r['score'] is None:
            conn.execute('UPDATE indicateurs SET rang_priorite=NULL WHERE id=?', (r['id'],))


def compute_globals(conn):
    """Compute indice_global and risque_global from indicator scores."""
    rows = conn.execute('SELECT * FROM indicateurs').fetchall()
    active = [r for r in rows if r['statut'] != 'na' and r['score'] is not None]
    total_poids = sum(float(r['poids']) for r in active) or 1.0
    indice = round(sum(float(r['score']) * float(r['poids']) / total_poids for r in active) * 100, 1) if active else 0.0
    risque = round(sum(float(r['points_risque']) * float(r['poids']) / total_poids for r in active), 2) if active else 0.0
    return indice, risque


def log_audit(conn, user_session, action, entity_type, entity_id, details=''):
    conn.execute(
        'INSERT INTO audit_logs (timestamp,user_id,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?)',
        (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
         user_session.get('id', ''),
         user_session.get('prenom', '') + ' ' + user_session.get('nom', ''),
         action, entity_type, str(entity_id), details)
    )


# ── PAGES ────────────────────────────────────────────────────────

@app.route('/')
@login_required
def index():
    user = dict(session['user'])
    # Always fetch fresh photo_url from DB so it reflects the latest upload
    conn = db.get_conn()
    row = conn.execute('SELECT photo_url,role FROM users WHERE id=?', (session['user_id'],)).fetchone()
    conn.close()
    if row:
        user['photo_url'] = row['photo_url'] or ''
        session['role'] = row['role']
        session['user']['photo_url'] = user['photo_url']
        session.modified = True
    return render_template('app.html', user=user)


@app.route('/login', methods=['GET'])
def login_page():
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    conn = db.get_conn()
    user = conn.execute(
        'SELECT * FROM users WHERE email = ? AND actif = 1', (email,)
    ).fetchone()
    if not user or not check_password_hash(user['password_hash'], password):
        conn.close()
        return jsonify({'error': 'Email ou mot de passe incorrect'}), 401
    initials = (user['prenom'][0] + user['nom'][0]).upper()
    session['user_id'] = user['id']
    session['role'] = user['role']
    session['user'] = {
        'id': user['id'], 'nom': user['nom'], 'prenom': user['prenom'],
        'email': user['email'], 'role': user['role'],
        'role_label': ROLE_LABELS.get(user['role'], user['role']),
        'initials': initials, 'avatar_color': user['avatar_color'],
        'photo_url': user['photo_url'] or '',
    }
    conn.execute(
        'UPDATE users SET derniere_cnx = ? WHERE id = ?',
        (datetime.now().strftime('%Y-%m-%d %H:%M'), user['id'])
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    generic = {'ok': True, 'message': "Si un compte existe pour cet email, un lien de réinitialisation a été envoyé."}
    if not email:
        return jsonify({'error': 'Email requis'}), 400
    conn = db.get_conn()
    user = conn.execute('SELECT * FROM users WHERE email = ? AND actif = 1', (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify(generic)
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = (datetime.now() + timedelta(minutes=RESET_TOKEN_TTL_MIN)).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute(
        'UPDATE users SET reset_token_hash=?, reset_token_expires=? WHERE id=?',
        (token_hash, expires, user['id'])
    )
    conn.commit()
    conn.close()
    reset_link = f'{APP_BASE_URL}/reset-password?token={token}'
    try:
        send_reset_email(user['email'], f"{user['prenom']} {user['nom']}", reset_link)
    except Exception:
        app.logger.exception('Échec envoi email de réinitialisation pour %s', email)
    return jsonify(generic)


@app.route('/reset-password', methods=['GET'])
def reset_password_page():
    token = request.args.get('token', '')
    return render_template('reset_password.html', token=token)


@app.route('/api/reset-password', methods=['POST'])
def api_reset_password():
    data = request.get_json() or {}
    token = data.get('token', '')
    new_pwd = data.get('new_password', '')
    cfm_pwd = data.get('confirm_password', '')
    if not token:
        return jsonify({'error': 'Lien de réinitialisation invalide'}), 400
    if len(new_pwd) < 8:
        return jsonify({'error': 'Le mot de passe doit faire au moins 8 caractères'}), 400
    if new_pwd != cfm_pwd:
        return jsonify({'error': 'Les mots de passe ne correspondent pas'}), 400
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    conn = db.get_conn()
    user = conn.execute(
        'SELECT * FROM users WHERE reset_token_hash = ? AND actif = 1', (token_hash,)
    ).fetchone()
    if not user or not user['reset_token_expires'] or \
            datetime.strptime(user['reset_token_expires'], '%Y-%m-%d %H:%M:%S') < datetime.now():
        conn.close()
        return jsonify({'error': 'Lien expiré ou invalide — refaites une demande'}), 400
    conn.execute(
        'UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_token_expires=NULL WHERE id=?',
        (generate_password_hash(new_pwd), user['id'])
    )
    log_audit(conn, {'id': user['id'], 'prenom': user['prenom'], 'nom': user['nom']},
              'reset_password', 'user', user['id'], 'Réinitialisation via lien email')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── DASHBOARD ────────────────────────────────────────────────────

@app.route('/api/dashboard')
@login_required
def api_dashboard():
    conn = db.get_conn()
    inds = conn.execute('SELECT * FROM indicateurs').fetchall()
    actions = conn.execute('SELECT * FROM actions').fetchall()
    incidents = conn.execute(
        'SELECT * FROM incidents ORDER BY date DESC LIMIT 4'
    ).fetchall()
    revue = conn.execute(
        'SELECT * FROM settings WHERE cle = ?', ('revue_scores',)
    ).fetchone()
    revue_trend = conn.execute(
        'SELECT score_8d, indice FROM revue_history ORDER BY id DESC LIMIT 8'
    ).fetchall()
    conn.close()
    trend_8d = list(reversed([float(r['score_8d']) for r in revue_trend]))
    trend_ind = list(reversed([float(r['indice']) for r in revue_trend]))

    now = datetime.now().date()
    total = len(actions)
    closed = sum(1 for a in actions if a['statut'] == 'cloturee')
    retard = sum(
        1 for a in actions
        if a['statut'] != 'cloturee' and a['delai']
        and datetime.strptime(a['delai'], '%Y-%m-%d').date() < now
    )
    taux = round(closed / total * 100) if total else 0

    # Compute real indice_global and risque_global
    active = [i for i in inds if i['statut'] != 'na' and i['score'] is not None]
    total_poids = sum(float(i['poids']) for i in active) or 1.0
    indice_global = round(
        sum(float(i['score']) * float(i['poids']) / total_poids for i in active) * 100, 1
    ) if active else 0.0
    risque_global = round(
        sum(float(i['points_risque']) * float(i['poids']) / total_poids for i in active), 1
    ) if active else 0.0

    domain_sum = {}
    domain_cnt = {}
    domain_poids = {}
    for ind in inds:
        if ind['statut'] == 'na' or ind['score'] is None:
            continue
        d = ind['domaine']
        w = float(ind['poids'])
        domain_sum[d] = domain_sum.get(d, 0) + float(ind['score']) * w
        domain_poids[d] = domain_poids.get(d, 0) + w
        domain_cnt[d] = domain_cnt.get(d, 0) + 1

    ORDER = ['HSE', 'QUAL', 'OA', 'GC', 'ENV', 'TOPO', 'GEO', 'WX']
    domains = []
    for d in ORDER:
        if d in domain_poids and domain_poids[d] > 0:
            domains.append({
                'dom': d,
                'score': round(domain_sum[d] / domain_poids[d] * 100, 1)
            })

    statuts = {}
    for ind in inds:
        statuts[ind['statut']] = statuts.get(ind['statut'], 0) + 1

    scores = json.loads(revue['valeur']) if revue else {
        'perf': 78, 'risque': 66, 'crit': 41, 'cloture': 52, 'arb': 55, 'stock_prio': 60, 'revue7j': 70
    }
    poids_8d = {'perf': .25, 'risque': .20, 'crit': .15, 'cloture': .15, 'arb': .10, 'stock_prio': .10, 'revue7j': .05}
    score_8d = round(sum(scores.get(k, 0) * v for k, v in poids_8d.items()), 1)

    return jsonify({
        'actions_total': total,
        'actions_ouvertes': total - closed,
        'actions_retard': retard,
        'taux_cloture': taux,
        'domains': domains,
        'statuts': statuts,
        'incidents_recents': [dict(i) for i in incidents],
        'score_8d': score_8d,
        'indice_global': indice_global,
        'risque_global': risque_global,
        'trend_8d': trend_8d,
        'trend_indice': trend_ind,
    })


# ── INDICATEURS ──────────────────────────────────────────────────

@app.route('/api/indicateurs')
@login_required
def api_indicateurs():
    conn = db.get_conn()
    rows = conn.execute(
        'SELECT * FROM indicateurs ORDER BY rang, id'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/indicateurs/<ind_id>')
@login_required
def api_indicateur(ind_id):
    conn = db.get_conn()
    ind = conn.execute(
        'SELECT * FROM indicateurs WHERE id = ?', (ind_id,)
    ).fetchone()
    if not ind:
        conn.close()
        return jsonify({'error': 'Non trouvé'}), 404
    hist = conn.execute(
        'SELECT * FROM observations WHERE indicateur_id = ? ORDER BY id DESC LIMIT 10',
        (ind_id,)
    ).fetchall()
    acts = conn.execute(
        'SELECT * FROM actions WHERE source_id = ? ORDER BY date_creation DESC',
        (ind_id,)
    ).fetchall()
    mod_hist = conn.execute(
        'SELECT * FROM indicateur_history WHERE ind_id = ? ORDER BY id DESC LIMIT 20',
        (ind_id,)
    ).fetchall()
    conn.close()
    return jsonify({
        'indicateur': dict(ind),
        'historique': [dict(h) for h in hist],
        'actions': [dict(a) for a in acts],
        'mod_history': [dict(m) for m in mod_hist],
    })


@app.route('/api/indicateurs/<ind_id>', methods=['DELETE'])
@login_required
def api_delete_indicateur(ind_id):
    if session.get('role') not in ('admin', 'direction'):
        return jsonify({'error': 'Accès refusé'}), 403
    conn = db.get_conn()
    row = conn.execute('SELECT id FROM indicateurs WHERE id = ?', (ind_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Non trouvé'}), 404
    conn.execute('DELETE FROM observations WHERE indicateur_id = ?', (ind_id,))
    conn.execute('DELETE FROM indicateurs WHERE id = ?', (ind_id,))
    recalc_indicators(conn)
    log_audit(conn, session.get('user', 'inconnu'), 'delete_indicateur', 'indicateur', ind_id, f'suppression indicateur {ind_id}')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/indicateurs/<ind_id>/seuil', methods=['PUT'])
@login_required
def api_set_seuil(ind_id):
    data = request.get_json() or {}
    seuil = data.get('seuil_alerte')
    conn = db.get_conn()
    if seuil is None or seuil == '':
        conn.execute('UPDATE indicateurs SET seuil_alerte=NULL WHERE id=?', (ind_id,))
    else:
        try:
            conn.execute('UPDATE indicateurs SET seuil_alerte=? WHERE id=?', (float(seuil), ind_id))
        except (ValueError, TypeError):
            conn.close()
            return jsonify({'error': 'Valeur invalide'}), 400
    log_audit(conn, session['user'], 'set_seuil', 'indicateur', ind_id, f'seuil={seuil}')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/indicateurs/<ind_id>/observation', methods=['POST'])
@login_required
def api_observation(ind_id):
    data = request.get_json() or {}
    statut = data.get('statut', 'conforme')
    commentaire = data.get('commentaire', '')

    score_map = {'conforme': 1.0, 'nc_mineure': 0.75, 'nc_majeure': 0.5, 'nc_critique': 0.0, 'na': None}
    rq_map = {'conforme': 0, 'nc_mineure': 1, 'nc_majeure': 2, 'nc_critique': 3, 'na': 0}
    dl_map = {'nc_critique': 1, 'nc_majeure': 3, 'nc_mineure': 14}
    prio_map = {'nc_critique': 'critique', 'nc_majeure': 'majeure', 'nc_mineure': 'mineure'}

    score = score_map.get(statut)
    rq = rq_map.get(statut, 0)
    user = session['user']
    who = user['prenom'] + ' ' + user['nom']
    now_str = datetime.now().strftime('%d/%m/%y')

    conn = db.get_conn()
    ind = conn.execute('SELECT * FROM indicateurs WHERE id = ?', (ind_id,)).fetchone()
    if not ind:
        conn.close()
        return jsonify({'error': 'Indicateur non trouvé'}), 404

    prev_statut = ind['statut']
    photos = json.dumps(data.get('photos') or [])
    conn.execute(
        'INSERT INTO observations (indicateur_id,date,statut,score,observateur,commentaire,photos) VALUES (?,?,?,?,?,?,?)',
        (ind_id, now_str, statut, score, who, commentaire, photos)
    )
    conn.execute(
        'UPDATE indicateurs SET statut=?,score=?,points_risque=? WHERE id=?',
        (statut, score, rq, ind_id)
    )

    action_id = None
    if statut in ('nc_critique', 'nc_majeure'):
        delay = dl_map[statut]
        deadline = (datetime.now() + timedelta(days=delay)).strftime('%Y-%m-%d')
        cnt = conn.execute('SELECT COUNT(*) FROM actions').fetchone()[0]
        action_id = f'ACT-{cnt + 1:03d}'
        conn.execute(
            'INSERT INTO actions (id,source_id,libelle,domaine,responsable,delai,avancement,statut,priorite,date_creation) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (action_id, ind_id, f"Corrective auto — {ind['libelle']}",
             ind['domaine'], who, deadline, 0, 'ouverte', prio_map[statut],
             datetime.now().strftime('%Y-%m-%d'))
        )
        conn.execute(
            'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
            ('danger', f'NC {statut.split("_")[1]} — {ind_id}',
             f"{ind['libelle']} · {ind['zone']}", "à l'instant", 0)
        )

    # Recalculate all computed fields
    recalc_indicators(conn)

    # Log indicator modification history
    conn.execute(
        'INSERT INTO indicateur_history (ind_id,date,action,ancien_statut,nouveau_statut,ancien_score,nouveau_score,modif_par,details) VALUES (?,?,?,?,?,?,?,?,?)',
        (ind_id, datetime.now().strftime('%Y-%m-%d %H:%M'), 'observation',
         prev_statut, statut, ind['score'], score, who, commentaire[:100] if commentaire else '')
    )

    # Threshold alert: notify if score drops below seuil_alerte
    seuil = ind['seuil_alerte'] if ind['seuil_alerte'] is not None else None
    if seuil is not None and score is not None and score < seuil:
        conn.execute(
            'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
            ('danger', f'Seuil dépassé — {ind_id}',
             f"{ind['libelle']} · score {score:.2f} < seuil {seuil:.2f}", "à l'instant", 0)
        )

    log_audit(conn, user, 'observation', 'indicateur', ind_id,
              f'{prev_statut} → {statut}')

    conn.commit()
    conn.close()

    msg = f'Observation enregistrée : {ind_id} → {statut}'
    if action_id:
        msg += f' · Action {action_id} créée (J+{dl_map[statut]})'
    return jsonify({'ok': True, 'message': msg, 'action_id': action_id})


@app.route('/api/observations/<int:obs_id>', methods=['DELETE'])
@login_required
def api_delete_observation(obs_id):
    conn = db.get_conn()
    row = conn.execute('SELECT indicateur_id FROM observations WHERE id = ?', (obs_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Non trouvé'}), 404
    ind_id = row['indicateur_id']
    user = session.get('user', 'inconnu')
    conn.execute('DELETE FROM observations WHERE id = ?', (obs_id,))
    recalc_indicators(conn)
    log_audit(conn, user, 'delete_observation', 'observation', str(obs_id), f'suppression obs #{obs_id} de {ind_id}')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── ACTIONS ──────────────────────────────────────────────────────

@app.route('/api/actions')
@login_required
def api_actions():
    conn = db.get_conn()
    rows = conn.execute('SELECT * FROM actions ORDER BY date_creation DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/actions', methods=['POST'])
@login_required
def api_create_action():
    data = request.get_json() or {}
    if not data.get('libelle') or not data.get('domaine') or not data.get('responsable') or not data.get('delai'):
        return jsonify({'error': 'Champs obligatoires manquants'}), 400
    conn = db.get_conn()
    cnt = conn.execute('SELECT COUNT(*) FROM actions').fetchone()[0]
    new_id = f'ACT-{cnt + 1:03d}'
    conn.execute(
        'INSERT INTO actions (id,source_id,libelle,domaine,responsable,delai,avancement,statut,priorite,date_creation) VALUES (?,?,?,?,?,?,?,?,?,?)',
        (new_id, data.get('source_id', ''), data['libelle'], data['domaine'],
         data['responsable'], data['delai'], 0, 'ouverte',
         data.get('priorite', 'majeure'), datetime.now().strftime('%Y-%m-%d'))
    )
    log_audit(conn, session['user'], 'create_action', 'action', new_id, data['libelle'])
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': new_id})


@app.route('/api/actions/<act_id>')
@login_required
def api_action_detail(act_id):
    conn = db.get_conn()
    act = conn.execute('SELECT * FROM actions WHERE id=?', (act_id,)).fetchone()
    if not act:
        conn.close()
        return jsonify({'error': 'Non trouvé'}), 404
    reviews = conn.execute(
        'SELECT * FROM action_reviews WHERE action_id=? ORDER BY id DESC',
        (act_id,)
    ).fetchall()
    conn.close()
    return jsonify({
        'action': dict(act),
        'reviews': [dict(r) for r in reviews],
    })


@app.route('/api/actions/<act_id>', methods=['PUT'])
@login_required
def api_update_action(act_id):
    data = request.get_json() or {}
    conn = db.get_conn()
    fields = []
    vals = []
    for f in ('avancement', 'statut', 'prochaine_revue', 'commentaire_pilote', 'responsable', 'delai', 'priorite'):
        if f in data:
            fields.append(f'{f}=?')
            vals.append(data[f])
    if fields:
        vals.append(act_id)
        conn.execute(f'UPDATE actions SET {",".join(fields)} WHERE id=?', vals)
    log_audit(conn, session['user'], 'update_action', 'action', act_id, str(data))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/actions/<act_id>/revue', methods=['POST'])
@login_required
def api_action_review(act_id):
    data = request.get_json() or {}
    who = session['user']['prenom'] + ' ' + session['user']['nom']
    avancement = int(data.get('avancement', 0))
    statut = data.get('statut', 'en_cours')
    conn = db.get_conn()
    conn.execute(
        'INSERT INTO action_reviews (action_id,date,statut,avancement,commentaire,reviewer) VALUES (?,?,?,?,?,?)',
        (act_id, datetime.now().strftime('%Y-%m-%d'), statut, avancement,
         data.get('commentaire', ''), who)
    )
    upd = {'avancement': avancement, 'statut': statut}
    if data.get('prochaine_revue'):
        upd['prochaine_revue'] = data['prochaine_revue']
    if data.get('commentaire_pilote'):
        upd['commentaire_pilote'] = data['commentaire_pilote']
    fields = ', '.join(f'{k}=?' for k in upd)
    vals = list(upd.values()) + [act_id]
    conn.execute(f'UPDATE actions SET {fields} WHERE id=?', vals)
    log_audit(conn, session['user'], 'revue_action', 'action', act_id,
              f'av={avancement}% statut={statut}')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/actions/<act_id>', methods=['DELETE'])
@login_required
def api_delete_action(act_id):
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    conn = db.get_conn()
    conn.execute('DELETE FROM action_reviews WHERE action_id=?', (act_id,))
    conn.execute('DELETE FROM actions WHERE id=?', (act_id,))
    log_audit(conn, session['user'], 'delete_action', 'action', act_id, '')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── INCIDENTS ────────────────────────────────────────────────────

@app.route('/api/incidents')
@login_required
def api_incidents():
    conn = db.get_conn()
    rows = conn.execute('SELECT * FROM incidents ORDER BY date DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/incidents', methods=['POST'])
@login_required
def api_create_incident():
    data = request.get_json() or {}
    if not data.get('description'):
        return jsonify({'error': 'Description obligatoire'}), 400
    conn = db.get_conn()
    cnt = conn.execute('SELECT COUNT(*) FROM incidents').fetchone()[0]
    new_id = f'INC-{cnt + 1:03d}'
    photos = json.dumps(data.get('photos') or [])
    conn.execute(
        'INSERT INTO incidents (id,date,zone,type,gravite,jours_arret,description,cause,responsable,statut,action_immediate,photos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        (new_id, data.get('date', datetime.now().strftime('%Y-%m-%d')),
         data.get('zone', 'Zone A'), data.get('type', 'HSE'),
         data.get('gravite', 'mineur'), int(data.get('jours_arret', 0)),
         data['description'], data.get('cause', 'En investigation'),
         data.get('responsable', ''), 'ouvert', data.get('action_immediate', ''),
         photos)
    )
    log_audit(conn, session['user'], 'create_incident', 'incident', new_id, data['description'])
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': new_id})


@app.route('/api/incidents/<inc_id>')
@login_required
def api_incident_detail(inc_id):
    conn = db.get_conn()
    inc = conn.execute('SELECT * FROM incidents WHERE id=?', (inc_id,)).fetchone()
    if not inc:
        conn.close()
        return jsonify({'error': 'Non trouvé'}), 404
    conn.close()
    return jsonify({'incident': dict(inc)})


@app.route('/api/incidents/<inc_id>', methods=['PUT'])
@login_required
def api_update_incident(inc_id):
    data = request.get_json() or {}
    conn = db.get_conn()
    fields = []
    vals = []
    for f in ('statut', 'cause', 'action_immediate', 'responsable', 'jours_arret', 'date_cloture', 'cloture_par'):
        if f in data:
            fields.append(f'{f}=?')
            vals.append(data[f])
    if data.get('statut') == 'cloture':
        who = session['user']['prenom'] + ' ' + session['user']['nom']
        if 'date_cloture' not in data:
            fields.append('date_cloture=?')
            vals.append(datetime.now().strftime('%Y-%m-%d'))
        if 'cloture_par' not in data:
            fields.append('cloture_par=?')
            vals.append(who)
    if fields:
        vals.append(inc_id)
        conn.execute(f'UPDATE incidents SET {",".join(fields)} WHERE id=?', vals)
    log_audit(conn, session['user'], 'update_incident', 'incident', inc_id, str(data))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/incidents/<inc_id>', methods=['DELETE'])
@login_required
def api_delete_incident(inc_id):
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    conn = db.get_conn()
    conn.execute('DELETE FROM incidents WHERE id=?', (inc_id,))
    log_audit(conn, session['user'], 'delete_incident', 'incident', inc_id, '')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── TF/TG ────────────────────────────────────────────────────────

@app.route('/api/tf_tg')
@login_required
def api_tf_tg():
    conn = db.get_conn()
    rows = conn.execute(
        'SELECT * FROM tf_tg_history ORDER BY annee DESC, id DESC LIMIT 12'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/tf_tg', methods=['POST'])
@login_required
def api_save_tf_tg():
    data = request.get_json() or {}
    h = int(data.get('heures_travaillees', 0))
    acc = int(data.get('nb_accidents', 0))
    ja = int(data.get('jours_arret', 0))
    tf = round(acc / h * 1_000_000, 2) if h else 0.0
    tg = round(ja / h * 1_000, 3) if h else 0.0
    conn = db.get_conn()
    conn.execute(
        'INSERT INTO tf_tg_history (mois,annee,heures_travaillees,nb_accidents,jours_arret,tf,tg) VALUES (?,?,?,?,?,?,?)',
        (data.get('mois', ''), int(data.get('annee', datetime.now().year)),
         h, acc, ja, tf, tg)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'tf': tf, 'tg': tg})


# ── JOBS ─────────────────────────────────────────────────────────

@app.route('/api/jobs/<job_id>', methods=['POST'])
@login_required
def api_run_job(job_id):
    conn = db.get_conn()
    now = datetime.now()
    who = session['user']['prenom'] + ' ' + session['user']['nom']
    created = []

    if job_id == 'retard':
        actions = conn.execute(
            "SELECT * FROM actions WHERE statut != 'cloturee'"
        ).fetchall()
        retard = [a for a in actions if a['delai'] and
                  datetime.strptime(a['delai'], '%Y-%m-%d').date() < now.date()]
        for a in retard:
            conn.execute(
                'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
                ('warning', f'Action en retard — {a["id"]}',
                 f'{a["libelle"][:50]} · resp. {a["responsable"]}',
                 now.strftime('%d/%m à %H:%M'), 0)
            )
        msg = f'{len(retard)} action(s) en retard détectée(s)'
        created = [a['id'] for a in retard]

    elif job_id == 'score8d':
        row = conn.execute("SELECT valeur FROM settings WHERE cle='revue_scores'").fetchone()
        scores = json.loads(row['valeur']) if row else {}
        poids = {'perf': .25, 'risque': .20, 'crit': .15, 'cloture': .15, 'arb': .10, 'stock_prio': .10, 'revue7j': .05}
        score_8d = round(sum(scores.get(k, 0) * v for k, v in poids.items()), 1)
        gf = scores.get('risque', 100) < 30 or scores.get('arb', 100) < 30
        feu = 'rouge' if gf or score_8d < 55 else 'orange' if score_8d < 85 else 'vert'
        niveau = 'danger' if feu == 'rouge' else 'warning' if feu == 'orange' else 'info'
        conn.execute(
            'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
            (niveau, f'Score 8D recalculé = {score_8d}',
             f'Feu {feu.upper()} — seuils ≥85 GO · ≥70 Renforcé · <55 Direction', now.strftime('%d/%m à %H:%M'), 0)
        )
        msg = f'Score 8D = {score_8d} / 100 — feu {feu.upper()}'

    elif job_id == 'cloture':
        actions = conn.execute('SELECT * FROM actions').fetchall()
        total = len(actions)
        closed = sum(1 for a in actions if a['statut'] == 'cloturee')
        taux = round(closed / total * 100) if total else 0
        seuil_row = conn.execute("SELECT valeur FROM settings WHERE cle='chantier'").fetchone()
        cible = json.loads(seuil_row['valeur']).get('taux_cloture_cible', 80) if seuil_row else 80
        niveau = 'warning' if taux < cible else 'info'
        conn.execute(
            'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
            (niveau, f'Taux de clôture = {taux}%',
             f'{closed}/{total} actions clôturées · cible {cible}%', now.strftime('%d/%m à %H:%M'), 0)
        )
        msg = f'Taux de clôture : {taux}% (cible {cible}%)'

    elif job_id == 'echeances':
        in7 = now.date() + timedelta(days=7)
        actions = conn.execute(
            "SELECT * FROM actions WHERE statut != 'cloturee'"
        ).fetchall()
        proches = [a for a in actions if a['delai'] and
                   now.date() <= datetime.strptime(a['delai'], '%Y-%m-%d').date() <= in7]
        for a in proches:
            conn.execute(
                'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
                ('warning', f'Échéance J-{(datetime.strptime(a["delai"],"%Y-%m-%d").date()-now.date()).days} — {a["id"]}',
                 f'{a["libelle"][:50]} · resp. {a["responsable"]}',
                 now.strftime('%d/%m à %H:%M'), 0)
            )
        msg = f'{len(proches)} action(s) à échéance dans 7 jours'
        created = [a['id'] for a in proches]

    elif job_id == 'revue_hebdo':
        inds = conn.execute('SELECT * FROM indicateurs').fetchall()
        actions = conn.execute('SELECT * FROM actions').fetchall()
        nc_crit = sum(1 for i in inds if i['statut'] == 'nc_critique')
        retard = sum(1 for a in actions if a['statut'] != 'cloturee' and a['delai'] and
                     datetime.strptime(a['delai'], '%Y-%m-%d').date() < now.date())
        indice, _ = compute_globals(conn)
        conn.execute(
            'INSERT INTO notifications (niveau,titre,message,time_label,lue) VALUES (?,?,?,?,?)',
            ('info', f'Revue hebdomadaire — Sem. {now.isocalendar()[1]}',
             f'Indice {indice}/100 · {nc_crit} NC crit. · {retard} actions retard',
             now.strftime('%d/%m à %H:%M'), 0)
        )
        msg = f'Synthèse hebdomadaire générée — indice {indice}/100'

    else:
        conn.close()
        return jsonify({'error': 'Job inconnu'}), 404

    log_audit(conn, session['user'], f'job_{job_id}', 'job', job_id, msg)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'message': msg, 'created': created})


# ── AUDIT LOGS ───────────────────────────────────────────────────

@app.route('/api/audit_logs')
@login_required
def api_audit_logs():
    conn = db.get_conn()
    rows = conn.execute(
        'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ── IMPORT CSV ────────────────────────────────────────────────────

@app.route('/api/indicateurs/import_csv', methods=['POST'])
@login_required
def api_import_csv():
    if session.get('role') not in ('admin', 'direction'):
        return jsonify({'error': 'Accès refusé'}), 403
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier'}), 400
    f = request.files['file']
    content = f.read().decode('utf-8-sig', errors='replace')
    import csv, io
    reader = csv.DictReader(io.StringIO(content))
    REQUIRED = {'id', 'domaine', 'zone', 'libelle'}
    if not REQUIRED.issubset({k.strip().lower() for k in (reader.fieldnames or [])}):
        return jsonify({'error': f'Colonnes requises manquantes : {REQUIRED}'}), 400
    conn = db.get_conn()
    created, updated, errors = 0, 0, []
    for i, row in enumerate(reader, 2):
        row = {k.strip().lower(): v.strip() for k, v in row.items()}
        ind_id = row.get('id', '').upper()
        if not ind_id:
            errors.append(f'Ligne {i} : ID manquant'); continue
        bloquant = 1 if row.get('bloquant', '').lower() in ('1', 'oui', 'true', 'yes') else 0
        regl = 1 if row.get('reglementaire', '').lower() in ('1', 'oui', 'true', 'yes') else 0
        try:
            poids = float(row.get('poids', 1.0) or 1.0)
            pts_risque = int(row.get('points_risque', 1) or 1)
        except ValueError:
            errors.append(f'Ligne {i} : valeur numérique invalide'); continue
        existing = conn.execute('SELECT id FROM indicateurs WHERE id=?', (ind_id,)).fetchone()
        if existing:
            conn.execute('UPDATE indicateurs SET domaine=?,zone=?,libelle=?,bloquant=?,reglementaire=?,poids=?,points_risque=? WHERE id=?',
                         (row['domaine'], row['zone'], row['libelle'], bloquant, regl, poids, pts_risque, ind_id))
            updated += 1
        else:
            conn.execute('INSERT INTO indicateurs (id,domaine,zone,libelle,bloquant,reglementaire,statut,score,poids,points_risque) VALUES (?,?,?,?,?,?,?,?,?,?)',
                         (ind_id, row['domaine'], row['zone'], row['libelle'], bloquant, regl, 'na', None, poids, pts_risque))
            created += 1
    recalc_indicators(conn)
    log_audit(conn, session.get('user',''), 'import_csv', 'indicateurs', 'bulk', f'{created} créés, {updated} mis à jour')
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'created': created, 'updated': updated, 'errors': errors})


# ── EXPORT CIBLÉ PDF ─────────────────────────────────────────────

@app.route('/api/export/filtered')
@login_required
def api_export_filtered():
    from io import BytesIO
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from flask import send_file

    export_type = request.args.get('type', '')
    conn = db.get_conn()
    now = datetime.now()
    today_str = now.strftime('%Y-%m-%d')
    who = session['user']['prenom'] + ' ' + session['user']['nom']

    # ── Couleurs partagées ────────────────────────────────────────
    C_INK  = colors.HexColor('#1a1d23')
    C_RED  = colors.HexColor('#A32D2D')
    C_REDL = colors.HexColor('#FCEBEB')
    C_ORA  = colors.HexColor('#854F0B')
    C_ORAL = colors.HexColor('#FEF3E2')
    C_GRN  = colors.HexColor('#3B6D11')
    C_GRNL = colors.HexColor('#EAF3DE')
    C_BLU  = colors.HexColor('#185FA5')
    C_BLUL = colors.HexColor('#EBF3FB')
    C_GRAY = colors.HexColor('#F6F8FA')
    C_BORD = colors.HexColor('#E4E7EC')
    C_TXT  = colors.HexColor('#374151')

    sty = getSampleStyleSheet()

    def P(txt, **kw):
        s = ParagraphStyle('_', parent=sty['Normal'], **kw)
        return Paragraph(str(txt), s)

    def _build_doc(page_size, lm=15, rm=15):
        buf = BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=page_size,
                                leftMargin=lm*mm, rightMargin=rm*mm,
                                topMargin=12*mm, bottomMargin=14*mm)
        W = page_size[0] - (lm + rm)*mm
        return buf, doc, W

    def _header(story, W, title, subtitle, count_label):
        hdata = [[
            P('QSSE-Wx', fontSize=16, fontName='Helvetica-Bold',
              textColor=colors.white, leading=20),
            P(f'{title}<br/><font size="8" color="#aaaaaa">{subtitle}</font>',
              fontSize=11, textColor=colors.white, leading=15),
            P(f'{count_label}<br/><font size="8" color="#aaaaaa">Généré le {now.strftime("%d/%m/%Y %H:%M")} · {who}</font>',
              fontSize=9, textColor=colors.white, leading=13, alignment=TA_RIGHT),
        ]]
        ht = Table(hdata, colWidths=[W*0.22, W*0.50, W*0.28])
        ht.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), C_INK),
            ('TOPPADDING', (0,0), (-1,-1), 10),
            ('BOTTOMPADDING', (0,0), (-1,-1), 10),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(ht)
        story.append(Spacer(1, 5*mm))

    def _section(story, W, txt, bg=None):
        bg = bg or C_INK
        t = Table([[P(txt, fontSize=9, fontName='Helvetica-Bold',
                      textColor=colors.white, leading=12)]], colWidths=[W])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), bg),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
        ]))
        story.append(t)

    def _table_style(n_rows, header_bg=None, row_colors=None, col_widths=None):
        header_bg = header_bg or C_INK
        base = [
            ('BACKGROUND', (0,0), (-1,0), header_bg),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,0), 8),
            ('BOTTOMPADDING', (0,0), (-1,0), 6),
            ('TOPPADDING', (0,0), (-1,0), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('FONTSIZE', (0,1), (-1,-1), 7.5),
            ('TOPPADDING', (0,1), (-1,-1), 5),
            ('BOTTOMPADDING', (0,1), (-1,-1), 5),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_GRAY]),
            ('GRID', (0,0), (-1,-1), 0.3, C_BORD),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]
        if row_colors:
            for r_idx, bg, tc in row_colors:
                base += [
                    ('BACKGROUND', (0, r_idx), (-1, r_idx), bg),
                    ('TEXTCOLOR', (0, r_idx), (-1, r_idx), tc),
                ]
        return base

    def _send(buf, doc, story, filename, label, rh_type):
        def _footer(canvas, doc):
            canvas.saveState()
            canvas.setFont('Helvetica', 7)
            canvas.setFillColor(colors.HexColor('#9CA3AF'))
            canvas.drawString(15*mm, 8*mm, f'QSSE-Wx A89 — Export confidentiel — {now.strftime("%d/%m/%Y")}')
            canvas.drawRightString(doc.pagesize[0] - 15*mm, 8*mm, f'Page {doc.page}')
            canvas.restoreState()
        doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
        buf.seek(0)
        rh = db.get_conn()
        rh.execute(
            'INSERT INTO report_history (type,label,filename,generated_by,generated_at) VALUES (?,?,?,?,?)',
            (rh_type, label, filename, who, now.strftime('%Y-%m-%d %H:%M'))
        )
        rh.commit(); rh.close()
        return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=filename)

    # ── NC Critiques & Majeures ───────────────────────────────────
    if export_type == 'nc_critiques':
        rows = conn.execute(
            "SELECT * FROM indicateurs WHERE statut IN ('nc_critique','nc_majeure') ORDER BY rang_priorite ASC"
        ).fetchall()
        conn.close()

        buf, doc, W = _build_doc(landscape(A4), lm=12, rm=12)
        story = []
        _header(story, W, 'Indicateurs en écart — NC Critiques & Majeures',
                'A89 · Chantier autoroutier', f'{len(rows)} indicateur(s) en écart')
        _section(story, W, f'  Classement par rang de priorité · {now.strftime("%d/%m/%Y")}')
        story.append(Spacer(1, 3*mm))

        ST_LBL = {'nc_critique':'NC critique','nc_majeure':'NC majeure','nc_mineure':'NC mineure','conforme':'Conforme','na':'N/A'}
        header = [P(h, fontSize=8, fontName='Helvetica-Bold', textColor=colors.white)
                  for h in ['#', 'ID', 'Domaine', 'Zone', 'Libellé', 'Statut', 'Score', 'Pts\nrisque', 'Bloquant', 'Régl.']]
        tdata = [header]
        row_colors = []
        for i, r in enumerate(rows, 1):
            bg = C_REDL if r['statut'] == 'nc_critique' else C_ORAL
            tc = C_RED  if r['statut'] == 'nc_critique' else C_ORA
            row_colors.append((i, bg, tc))
            score_txt = f"{r['score']:.2f}" if r['score'] is not None else 'N/A'
            tdata.append([
                P(str(r['rang_priorite'] or ''), fontSize=8, fontName='Helvetica-Bold', alignment=TA_CENTER),
                P(r['id'], fontSize=7.5, fontName='Helvetica-Bold'),
                P(r['domaine'], fontSize=7.5),
                P(r['zone'], fontSize=7.5),
                P(r['libelle'][:50], fontSize=7.5),
                P(ST_LBL.get(r['statut'], r['statut']), fontSize=7.5, fontName='Helvetica-Bold'),
                P(score_txt, fontSize=8, fontName='Helvetica-Bold', alignment=TA_CENTER),
                P(str(r['points_risque']), fontSize=8, alignment=TA_CENTER),
                P('Oui' if r['bloquant'] else '—', fontSize=7.5, alignment=TA_CENTER),
                P('Oui' if r['reglementaire'] else '—', fontSize=7.5, alignment=TA_CENTER),
            ])

        CW = [W*v for v in [0.04, 0.07, 0.08, 0.09, 0.30, 0.10, 0.07, 0.07, 0.09, 0.09]]
        t = Table(tdata, colWidths=CW, repeatRows=1)
        t.setStyle(TableStyle(_table_style(len(rows), row_colors=row_colors)))
        story.append(t)

        if not rows:
            story.append(Spacer(1,8*mm))
            story.append(P('Aucun indicateur en écart — tous les indicateurs sont conformes.',
                           fontSize=10, textColor=C_GRN, fontName='Helvetica-Bold', alignment=TA_CENTER))

        return _send(buf, doc, story, f'NC_Critiques_{now.strftime("%Y%m%d_%H%M")}.pdf',
                     'NC Critiques & Majeures', 'filtre_nc')

    # ── Actions en retard ─────────────────────────────────────────
    elif export_type == 'actions_retard':
        rows = conn.execute(
            "SELECT * FROM actions WHERE statut != 'cloturee' AND delai < ? ORDER BY delai ASC",
            (today_str,)
        ).fetchall()
        conn.close()

        buf, doc, W = _build_doc(landscape(A4), lm=12, rm=12)
        story = []
        _header(story, W, 'Actions en retard', 'A89 · Plan d\'actions', f'{len(rows)} action(s) en retard')
        _section(story, W, f'  Triées par délai croissant (plus ancien en premier) · {now.strftime("%d/%m/%Y")}', bg=C_ORA)
        story.append(Spacer(1, 3*mm))

        PRIO_COLORS = {'critique': (C_REDL, C_RED), 'majeure': (C_ORAL, C_ORA), 'mineure': (C_BLUL, C_BLU)}
        ASL = {'ouverte':'Ouverte','en_cours':'En cours','en_attente':'En attente'}
        header = [P(h, fontSize=8, fontName='Helvetica-Bold', textColor=colors.white)
                  for h in ['ID', 'Libellé', 'Domaine', 'Responsable', 'Délai', 'Retard', 'Avanc.', 'Statut', 'Priorité']]
        tdata = [header]
        row_colors = []
        for i, r in enumerate(rows, 1):
            bg, tc = PRIO_COLORS.get(r['priorite'], (C_GRAY, C_TXT))
            row_colors.append((i, bg, tc))
            try:
                d = datetime.strptime(r['delai'], '%Y-%m-%d').date()
                retard = (now.date() - d).days
                retard_txt = f'J+{retard}'
            except Exception:
                retard_txt = '?'
            tdata.append([
                P(r['id'], fontSize=7.5, fontName='Helvetica-Bold'),
                P(r['libelle'][:55], fontSize=7.5),
                P(r['domaine'], fontSize=7.5),
                P(r['responsable'], fontSize=7.5),
                P(r['delai'], fontSize=7.5, fontName='Helvetica-Bold'),
                P(retard_txt, fontSize=8, fontName='Helvetica-Bold', alignment=TA_CENTER),
                P(f"{r['avancement']}%", fontSize=8, alignment=TA_CENTER),
                P(ASL.get(r['statut'], r['statut']), fontSize=7.5),
                P(r['priorite'].capitalize(), fontSize=7.5, fontName='Helvetica-Bold'),
            ])

        CW = [W*v for v in [0.08, 0.30, 0.09, 0.13, 0.09, 0.07, 0.07, 0.09, 0.08]]
        t = Table(tdata, colWidths=CW, repeatRows=1)
        t.setStyle(TableStyle(_table_style(len(rows), header_bg=C_ORA, row_colors=row_colors)))
        story.append(t)

        if not rows:
            story.append(Spacer(1,8*mm))
            story.append(P('Aucune action en retard — toutes les échéances sont respectées.',
                           fontSize=10, textColor=C_GRN, fontName='Helvetica-Bold', alignment=TA_CENTER))

        return _send(buf, doc, story, f'Actions_Retard_{now.strftime("%Y%m%d_%H%M")}.pdf',
                     'Actions en retard', 'filtre_act')

    # ── Incidents ouverts ─────────────────────────────────────────
    elif export_type == 'incidents_ouverts':
        rows = conn.execute(
            "SELECT * FROM incidents WHERE statut != 'cloture' ORDER BY date DESC"
        ).fetchall()
        conn.close()

        buf, doc, W = _build_doc(landscape(A4), lm=12, rm=12)
        story = []
        _header(story, W, 'Incidents ouverts', 'A89 · Registre des incidents', f'{len(rows)} incident(s) ouvert(s)')
        _section(story, W, f'  Triés par date décroissante · {now.strftime("%d/%m/%Y")}', bg=C_BLU)
        story.append(Spacer(1, 3*mm))

        GRAV_C = {'grave': (C_REDL, C_RED), 'modere': (C_ORAL, C_ORA), 'mineur': (C_GRNL, C_GRN)}
        GRAV_L = {'grave':'Grave','modere':'Modéré','mineur':'Mineur'}
        ISL = {'investigation':'Investigation','en_cours':'En cours','ouvert':'Ouvert'}
        header = [P(h, fontSize=8, fontName='Helvetica-Bold', textColor=colors.white)
                  for h in ['ID', 'Date', 'Zone', 'Type', 'Gravité', 'Description', 'Cause', 'Responsable', 'Statut', 'J. arrêt']]
        tdata = [header]
        row_colors = []
        for i, r in enumerate(rows, 1):
            bg, tc = GRAV_C.get(r['gravite'], (C_GRAY, C_TXT))
            row_colors.append((i, bg, tc))
            tdata.append([
                P(r['id'], fontSize=7.5, fontName='Helvetica-Bold'),
                P(r['date'], fontSize=7.5),
                P(r['zone'], fontSize=7.5),
                P(r['type'].capitalize(), fontSize=7.5),
                P(GRAV_L.get(r['gravite'], r['gravite']), fontSize=7.5, fontName='Helvetica-Bold'),
                P((r['description'] or '')[:50], fontSize=7.5),
                P((r['cause'] or '')[:40], fontSize=7.5),
                P(r['responsable'], fontSize=7.5),
                P(ISL.get(r['statut'], r['statut']), fontSize=7.5),
                P(str(r['jours_arret']) if r['jours_arret'] else '0', fontSize=8, alignment=TA_CENTER),
            ])

        CW = [W*v for v in [0.07, 0.07, 0.07, 0.07, 0.07, 0.23, 0.18, 0.10, 0.09, 0.05]]
        t = Table(tdata, colWidths=CW, repeatRows=1)
        t.setStyle(TableStyle(_table_style(len(rows), header_bg=C_BLU, row_colors=row_colors)))
        story.append(t)

        if not rows:
            story.append(Spacer(1,8*mm))
            story.append(P('Aucun incident ouvert.', fontSize=10, textColor=C_GRN,
                           fontName='Helvetica-Bold', alignment=TA_CENTER))

        return _send(buf, doc, story, f'Incidents_Ouverts_{now.strftime("%Y%m%d_%H%M")}.pdf',
                     'Incidents ouverts', 'filtre_inc')

    else:
        conn.close()
        return jsonify({'error': 'Type inconnu'}), 400


# ── MON COMPTE ───────────────────────────────────────────────────

@app.route('/api/me', methods=['PUT'])
@login_required
def api_update_me():
    data = request.get_json() or {}
    user_id = session['user_id']
    conn = db.get_conn()
    old_pwd = data.get('old_password', '')
    new_pwd = data.get('new_password', '')
    cfm_pwd = data.get('confirm_password', '')
    if not old_pwd or not new_pwd:
        conn.close()
        return jsonify({'error': 'Champs obligatoires manquants'}), 400
    if len(new_pwd) < 8:
        conn.close()
        return jsonify({'error': 'Le nouveau mot de passe doit faire au moins 8 caractères'}), 400
    if new_pwd != cfm_pwd:
        conn.close()
        return jsonify({'error': 'Les mots de passe ne correspondent pas'}), 400
    row = conn.execute('SELECT password_hash FROM users WHERE id=?', (user_id,)).fetchone()
    if not row or not check_password_hash(row['password_hash'], old_pwd):
        conn.close()
        return jsonify({'error': 'Mot de passe actuel incorrect'}), 400
    conn.execute('UPDATE users SET password_hash=? WHERE id=?',
                 (generate_password_hash(new_pwd), user_id))
    log_audit(conn, session['user'], 'change_password', 'user', user_id, '')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── UTILISATEURS ─────────────────────────────────────────────────

@app.route('/api/recent-users')
def api_recent_users():
    conn = db.get_conn()
    rows = conn.execute(
        '''SELECT prenom, nom, email, role, avatar_color, photo_url, derniere_cnx
           FROM users WHERE actif=1 AND derniere_cnx IS NOT NULL
           ORDER BY derniere_cnx DESC LIMIT 3'''
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/users')
@login_required
def api_users():
    conn = db.get_conn()
    rows = conn.execute(
        'SELECT id,prenom,nom,email,role,domaine,actif,derniere_cnx,avatar_color FROM users ORDER BY nom'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/users', methods=['POST'])
@login_required
def api_create_user():
    data = request.get_json() or {}
    if not all([data.get('prenom'), data.get('nom'), data.get('email'), data.get('role'), data.get('password')]):
        return jsonify({'error': 'Tous les champs sont obligatoires'}), 400
    if len(data['password']) < 8:
        return jsonify({'error': 'Mot de passe min. 8 caractères'}), 400
    conn = db.get_conn()
    if conn.execute('SELECT id FROM users WHERE email=?', (data['email'].lower(),)).fetchone():
        conn.close()
        return jsonify({'error': 'Email déjà utilisé'}), 400
    import random
    colors = ['#185FA5', '#A32D2D', '#3B6D11', '#854F0B', '#7b3fa0', '#177a6a']
    cnt = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    new_id = f'u{cnt + 1}'
    conn.execute(
        '''INSERT INTO users (id,prenom,nom,email,role,domaine,actif,password_hash,avatar_color,derniere_cnx,photo_url)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
        (new_id, data['prenom'], data['nom'], data['email'].lower(),
         data['role'], data.get('domaine', ''), 1,
         generate_password_hash(data['password']),
         random.choice(colors), None, None)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': new_id})


@app.route('/api/users/<user_id>', methods=['PUT'])
@login_required
def api_update_user(user_id):
    data = request.get_json() or {}
    conn = db.get_conn()
    if 'actif' in data:
        conn.execute('UPDATE users SET actif=? WHERE id=?', (int(data['actif']), user_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/users/<user_id>', methods=['DELETE'])
@login_required
def api_delete_user(user_id):
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    if user_id == session['user_id']:
        return jsonify({'error': 'Impossible de supprimer votre propre compte'}), 400
    conn = db.get_conn()
    user = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    conn.execute('DELETE FROM users WHERE id=?', (user_id,))
    log_audit(conn, session['user'], 'delete_user', 'user', user_id,
              f'{user["prenom"]} {user["nom"]} ({user["email"]})')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── NOTIFICATIONS ────────────────────────────────────────────────

@app.route('/api/notifications')
@login_required
def api_notifications():
    conn = db.get_conn()
    rows = conn.execute('SELECT * FROM notifications ORDER BY id DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/notifications/<int:notif_id>/read', methods=['PUT'])
@login_required
def api_notif_read(notif_id):
    conn = db.get_conn()
    conn.execute('UPDATE notifications SET lue=1 WHERE id=?', (notif_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/notifications/read-all', methods=['PUT'])
@login_required
def api_notif_read_all():
    conn = db.get_conn()
    conn.execute('UPDATE notifications SET lue=1')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/notifications/<int:notif_id>', methods=['DELETE'])
@login_required
def api_delete_notif(notif_id):
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    conn = db.get_conn()
    conn.execute('DELETE FROM notifications WHERE id=?', (notif_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/notifications', methods=['DELETE'])
@login_required
def api_delete_all_notifs():
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    conn = db.get_conn()
    conn.execute('DELETE FROM notifications')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── REVUE 8D ─────────────────────────────────────────────────────

@app.route('/api/revue')
@login_required
def api_revue():
    conn = db.get_conn()
    row = conn.execute('SELECT valeur FROM settings WHERE cle=?', ('revue_scores',)).fetchone()
    hist = conn.execute(
        'SELECT * FROM revue_history ORDER BY id DESC LIMIT 10'
    ).fetchall()
    conn.close()
    scores = json.loads(row['valeur']) if row else {
        'perf': 78, 'risque': 66, 'crit': 41, 'cloture': 52, 'arb': 55, 'stock_prio': 60, 'revue7j': 70
    }
    return jsonify({'scores': scores, 'history': [dict(h) for h in hist]})


@app.route('/api/revue', methods=['POST'])
@login_required
def api_submit_revue():
    data = request.get_json() or {}
    scores = data.get('scores', {})
    poids = {'perf': .25, 'risque': .20, 'crit': .15, 'cloture': .15, 'arb': .10, 'stock_prio': .10, 'revue7j': .05}
    score_8d = round(sum(scores.get(k, 0) * v for k, v in poids.items()), 1)
    # Garde-fous non négociables
    gf_risque = scores.get('risque', 100) < 30
    gf_arb    = scores.get('arb', 100) < 30
    if gf_risque or gf_arb:
        feu = 'rouge'
        raison = 'Garde-fou risque' if gf_risque else 'Garde-fou arbitrage'
        dec = f'ARBITRAGE DIRECTION — {raison}'
    elif score_8d >= 85:
        feu, dec = 'vert',   'MAINTIEN / GO'
    elif score_8d >= 70:
        feu, dec = 'orange', 'PILOTAGE RENFORCÉ / GO'
    elif score_8d >= 55:
        feu, dec = 'orange', 'ALERTE — Plan d\'action renforcé requis'
    else:
        feu, dec = 'rouge',  'ARBITRAGE DIRECTION'
    who = session['user']['prenom'] + ' ' + session['user']['nom']
    conn = db.get_conn()
    indice_global, risque_global = compute_globals(conn)
    conn.execute('INSERT INTO settings (cle,valeur) VALUES (?,?) ON CONFLICT (cle) DO UPDATE SET valeur=excluded.valeur',
                 ('revue_scores', json.dumps(scores)))
    conn.execute(
        'INSERT INTO revue_history (date,score_8d,indice,risque,feu,decision,validateur) VALUES (?,?,?,?,?,?,?)',
        (datetime.now().strftime('%d/%m/%Y'), score_8d, indice_global, risque_global, feu, dec, who)
    )
    log_audit(conn, session['user'], 'valider_revue', 'revue', 'global',
              f'score_8d={score_8d} feu={feu}')
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'score_8d': score_8d, 'feu': feu, 'decision': dec})


# ── PARAMÈTRES ───────────────────────────────────────────────────

@app.route('/api/settings')
@login_required
def api_settings():
    conn = db.get_conn()
    rows = conn.execute('SELECT * FROM settings').fetchall()
    conn.close()
    return jsonify({r['cle']: json.loads(r['valeur']) for r in rows})


@app.route('/api/settings', methods=['PUT'])
@login_required
def api_save_settings():
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    data = request.get_json() or {}
    conn = db.get_conn()
    for key, val in data.items():
        conn.execute('INSERT INTO settings (cle,valeur) VALUES (?,?) ON CONFLICT (cle) DO UPDATE SET valeur=excluded.valeur',
                     (key, json.dumps(val)))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── RAPPORT PDF ──────────────────────────────────────────────────

@app.route('/api/rapport/pdf')
@login_required
def api_rapport_pdf():
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, HRFlowable)
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    conn = db.get_conn()
    inds      = conn.execute('SELECT * FROM indicateurs ORDER BY rang, id').fetchall()
    actions   = conn.execute('SELECT * FROM actions ORDER BY date_creation DESC').fetchall()
    incidents = conn.execute('SELECT * FROM incidents ORDER BY date DESC').fetchall()
    revue_row = conn.execute("SELECT valeur FROM settings WHERE cle='revue_scores'").fetchone()
    conn.close()

    rv = json.loads(revue_row['valeur']) if revue_row else {'perf':78,'risque':66,'crit':41,'cloture':52,'arb':55,'stock_prio':60,'revue7j':70}
    poids = {'perf':.25,'risque':.20,'crit':.15,'cloture':.15,'arb':.10,'stock_prio':.10,'revue7j':.05}
    score_8d = round(sum(rv.get(k,0)*v for k,v in poids.items()), 1)

    active = [i for i in inds if i['statut'] != 'na' and i['score'] is not None]
    total_poids = sum(float(i['poids']) for i in active) or 1.0
    indice_global = round(sum(float(i['score'])*float(i['poids'])/total_poids for i in active)*100, 1) if active else 0.0

    now = datetime.now()
    today = now.date()
    mois = now.strftime('%B %Y').capitalize()

    C_INK  = colors.HexColor('#1a1d23')
    C_RED  = colors.HexColor('#A32D2D')
    C_REDL = colors.HexColor('#FCEBEB')
    C_ORA  = colors.HexColor('#854F0B')
    C_ORAL = colors.HexColor('#FAEEDA')
    C_GRN  = colors.HexColor('#3B6D11')
    C_GRNL = colors.HexColor('#EAF3DE')
    C_BLU  = colors.HexColor('#185FA5')
    C_GRAY = colors.HexColor('#f6f8fa')
    C_BORD = colors.HexColor('#e4e7ec')

    STATUS_COLORS = {
        'nc_critique': C_RED, 'nc_majeure': C_ORA,
        'nc_mineure': colors.HexColor('#BA7517'), 'conforme': C_GRN, 'na': colors.gray,
    }
    STATUS_BG = {
        'nc_critique': C_REDL, 'nc_majeure': C_ORAL, 'nc_mineure': C_ORAL,
        'conforme': C_GRNL, 'na': C_GRAY,
    }
    STATUS_LBL = {
        'nc_critique': 'NC critique', 'nc_majeure': 'NC majeure',
        'nc_mineure': 'NC mineure', 'conforme': 'Conforme', 'na': 'N/A',
    }
    PRIO_COLORS = {'critique': C_RED, 'majeure': C_ORA, 'mineure': colors.HexColor('#BA7517')}
    GRAV_COLORS = {'grave': C_RED, 'modere': C_ORA, 'mineur': C_GRN}
    GRAV_LBL    = {'grave': 'Grave', 'modere': 'Modéré', 'mineur': 'Mineur'}

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=15*mm, rightMargin=15*mm,
                            topMargin=12*mm, bottomMargin=12*mm)
    W = A4[0] - 30*mm
    story = []

    sty = getSampleStyleSheet()
    def P(txt, style='Normal', **kw):
        s = ParagraphStyle('x', parent=sty[style], **kw)
        return Paragraph(txt, s)

    def section_title(txt, icon=''):
        tbl = Table([[P(f'{icon}  {txt}', 'Normal',
                        fontSize=10, fontName='Helvetica-Bold',
                        textColor=colors.white, spaceAfter=0, leading=14)]],
                    colWidths=[W])
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), C_INK),
            ('TOPPADDING', (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
        ]))
        return tbl

    def hr():
        return HRFlowable(width=W, thickness=0.5, color=C_BORD, spaceAfter=4, spaceBefore=4)

    feu_lbl  = 'VERT' if score_8d>=85 else 'ORANGE' if score_8d>=70 else 'ROUGE'
    feu_col  = C_GRN if score_8d>=85 else C_ORA if score_8d>=70 else C_RED
    feu_bgcol= C_GRNL if score_8d>=85 else C_ORAL if score_8d>=70 else C_REDL

    header_data = [[
        P('QSSE-Wx', 'Normal', fontSize=18, fontName='Helvetica-Bold', textColor=colors.white, leading=22),
        P(f'Rapport mensuel<br/><font size="9" color="#aaaaaa">A89 — Chantier autoroutier</font>',
          'Normal', fontSize=12, textColor=colors.white, leading=16),
        P(f'{mois}<br/><font size="9" color="#aaaaaa">Généré le {now.strftime("%d/%m/%Y à %H:%M")}</font>',
          'Normal', fontSize=10, textColor=colors.white, leading=14, alignment=TA_RIGHT),
    ]]
    header = Table(header_data, colWidths=[W*0.25, W*0.45, W*0.30])
    header.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), C_INK),
        ('TOPPADDING', (0,0), (-1,-1), 12),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(header)
    story.append(Spacer(1, 6*mm))

    dec_txt = 'ARBITRAGE DIRECTION' if score_8d<55 else "ALERTE — Plan d'action renforcé requis" if score_8d<70 else 'PILOTAGE RENFORCÉ / GO' if score_8d<85 else 'MAINTIEN / GO'
    dec_data = [[
        P(f'Décision automatique — Score 8D = {score_8d} / 100',
          'Normal', fontSize=8, textColor=feu_col, fontName='Helvetica-Bold', leading=11),
        P(f'● {feu_lbl}', 'Normal', fontSize=10, textColor=feu_col, fontName='Helvetica-Bold',
          alignment=TA_RIGHT, leading=14),
    ],[
        P(dec_txt, 'Normal', fontSize=11, textColor=feu_col, fontName='Helvetica-Bold', leading=14),
        P(f'Indice QSSE-Wx : {indice_global}', 'Normal', fontSize=9, textColor=C_BLU, alignment=TA_RIGHT, leading=12),
    ]]
    dec_table = Table(dec_data, colWidths=[W*0.70, W*0.30])
    dec_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), feu_bgcol),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('BOX', (0,0), (-1,-1), 0.5, feu_col),
    ]))
    story.append(dec_table)
    story.append(Spacer(1, 5*mm))

    total_acts = len(actions)
    closed = sum(1 for a in actions if a['statut'] == 'cloturee')
    retard = sum(1 for a in actions if a['statut'] != 'cloturee' and a['delai']
                 and datetime.strptime(a['delai'], '%Y-%m-%d').date() < today)
    taux = round(closed/total_acts*100) if total_acts else 0
    nc_crit = sum(1 for i in inds if i['statut'] == 'nc_critique')
    nc_maj  = sum(1 for i in inds if i['statut'] == 'nc_majeure')
    conformes = sum(1 for i in inds if i['statut'] == 'conforme')
    nb_eval = sum(1 for i in inds if i['statut'] != 'na')

    kpi_entries = [
        ('Indice QSSE-Wx', str(indice_global), C_BLU, '/100'),
        ('Score 8D', str(score_8d), feu_col, f'Feu {feu_lbl}'),
        ('NC critiques', str(nc_crit), C_RED, f'{nc_maj} NC majeures'),
        ('Conformité', f'{round(conformes/nb_eval*100) if nb_eval else 0}%', C_GRN, f'{conformes} indicateurs'),
        ('Actions retard', str(retard), C_RED if retard else C_GRN, f'{total_acts-closed} ouvertes · {taux}% clôt.'),
    ]
    kpi_row = []
    for lbl, val, col, sub in kpi_entries:
        kpi_row.append(
            Table([[P(lbl.upper(), 'Normal', fontSize=6.5, textColor=colors.HexColor('#5a6270'), leading=9)],
                   [P(val, 'Normal', fontSize=15, fontName='Helvetica-Bold', textColor=col, leading=19)],
                   [P(sub, 'Normal', fontSize=7, textColor=colors.HexColor('#9aa3b0'), leading=9)]],
                  colWidths=[W/5 - 3*mm])
        )
    kpi_table = Table([kpi_row], colWidths=[W/5]*5)
    kpi_table.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, C_BORD),
        ('INNERGRID', (0,0), (-1,-1), 0.5, C_BORD),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('BACKGROUND', (0,0), (-1,-1), colors.white),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 5*mm))

    story.append(section_title('Indicateurs — Non-conformités', '⬡'))
    story.append(Spacer(1, 3*mm))

    nc_rows = [i for i in inds if i['statut'] not in ('conforme','na')]
    if nc_rows:
        ind_header = ['ID', 'Domaine', 'Zone', 'Libellé', 'Bloquant', 'Statut', 'Score', 'Risque', 'Pds actif']
        ind_data = [ind_header]
        for i in nc_rows:
            pa = i['poids_actif'] if i['poids_actif'] is not None else 0
            ind_data.append([
                i['id'], i['domaine'], i['zone'],
                i['libelle'][:36]+'…' if len(i['libelle'])>36 else i['libelle'],
                'OUI' if i['bloquant'] else '—',
                STATUS_LBL.get(i['statut'], i['statut']),
                f"{i['score']:.2f}" if i['score'] is not None else '—',
                str(i['points_risque']),
                f"{float(pa):.3f}",
            ])
        ind_table = Table(ind_data, colWidths=[17*mm,13*mm,14*mm,W-105*mm,14*mm,19*mm,13*mm,11*mm,14*mm])
        ts = [
            ('BACKGROUND', (0,0), (-1,0), C_INK),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 7.5),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_GRAY]),
            ('GRID', (0,0), (-1,-1), 0.3, C_BORD),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 5),
        ]
        for row_idx, i in enumerate(nc_rows, start=1):
            col = STATUS_COLORS.get(i['statut'], colors.gray)
            ts.append(('TEXTCOLOR', (5,row_idx), (5,row_idx), col))
            ts.append(('FONTNAME', (5,row_idx), (5,row_idx), 'Helvetica-Bold'))
            if i['statut'] == 'nc_critique':
                ts.append(('BACKGROUND', (0,row_idx), (-1,row_idx), C_REDL))
        ind_table.setStyle(TableStyle(ts))
        story.append(ind_table)
    else:
        story.append(P('Aucune non-conformité.', 'Normal', fontSize=9, textColor=C_GRN))
    story.append(Spacer(1, 5*mm))

    story.append(section_title("Plan d'actions correctrices", '✓'))
    story.append(Spacer(1, 3*mm))

    open_acts = [a for a in actions if a['statut'] != 'cloturee']
    if open_acts:
        act_header = ['ID', 'Libellé', 'Domaine', 'Responsable', 'Délai', 'Av.', 'Statut', 'Priorité']
        act_data = [act_header]
        for a in open_acts:
            act_data.append([
                a['id'],
                (a['libelle'] or '')[:35]+'…' if len(a['libelle']or'')>35 else (a['libelle'] or ''),
                a['domaine'], a['responsable'],
                a['delai'].replace('-','/')[2:] if a['delai'] else '—',
                f"{a['avancement']}%",
                {'ouverte':'Ouverte','en_cours':'En cours','en_attente':'En attente','cloturee':'Clôturée'}.get(a['statut'],a['statut']),
                (a['priorite'] or '').capitalize(),
            ])
        act_table = Table(act_data, colWidths=[17*mm, W-107*mm, 14*mm, 22*mm, 16*mm, 10*mm, 14*mm, 14*mm])
        ts2 = [
            ('BACKGROUND', (0,0), (-1,0), C_INK),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 7.5),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_GRAY]),
            ('GRID', (0,0), (-1,-1), 0.3, C_BORD),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 5),
        ]
        for row_idx, a in enumerate(open_acts, start=1):
            prio_col = PRIO_COLORS.get(a['priorite'], colors.gray)
            ts2.append(('TEXTCOLOR', (7,row_idx), (7,row_idx), prio_col))
            ts2.append(('FONTNAME', (7,row_idx), (7,row_idx), 'Helvetica-Bold'))
            if a['delai'] and datetime.strptime(a['delai'],'%Y-%m-%d').date() < today:
                ts2.append(('BACKGROUND', (0,row_idx), (-1,row_idx), C_REDL))
        act_table.setStyle(TableStyle(ts2))
        story.append(act_table)
    else:
        story.append(P('Aucune action ouverte.', 'Normal', fontSize=9, textColor=C_GRN))
    story.append(Spacer(1, 5*mm))

    story.append(section_title('Registre des incidents', '⚠'))
    story.append(Spacer(1, 3*mm))

    if incidents:
        inc_header = ['ID', 'Date', 'Zone', 'Type', 'Gravité', 'J.A.', 'Description', 'Statut']
        inc_data = [inc_header]
        for i in incidents:
            inc_data.append([
                i['id'], i['date'].replace('-','/')[-5:] if i['date'] else '—',
                i['zone'], i['type'],
                GRAV_LBL.get(i['gravite'], i['gravite']),
                str(i['jours_arret']) if i['jours_arret'] else '—',
                (i['description'] or '')[:32]+'…' if len(i['description']or'')>32 else (i['description'] or ''),
                {'investigation':'Invest.','en_cours':'En cours','cloture':'Clôturé','ouvert':'Ouvert'}.get(i['statut'],i['statut']),
            ])
        inc_table = Table(inc_data, colWidths=[17*mm,14*mm,14*mm,13*mm,14*mm,9*mm,W-95*mm,16*mm])
        ts3 = [
            ('BACKGROUND', (0,0), (-1,0), C_INK),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 7.5),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_GRAY]),
            ('GRID', (0,0), (-1,-1), 0.3, C_BORD),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 5),
        ]
        for row_idx, i in enumerate(incidents, start=1):
            g_col = GRAV_COLORS.get(i['gravite'], colors.gray)
            ts3.append(('TEXTCOLOR', (4,row_idx), (4,row_idx), g_col))
            ts3.append(('FONTNAME', (4,row_idx), (4,row_idx), 'Helvetica-Bold'))
            if i['gravite'] == 'grave':
                ts3.append(('BACKGROUND', (0,row_idx), (-1,row_idx), C_REDL))
        inc_table.setStyle(TableStyle(ts3))
        story.append(inc_table)
    story.append(Spacer(1, 5*mm))

    story.append(section_title('Matrice de décision 8D', '◈'))
    story.append(Spacer(1, 3*mm))

    rv_lbls = {'perf':'Performance','risque':'Risque (inv.)','crit':'Criticité','cloture':'Taux clôture','arb':'Arbitrage'}
    comp_data = [['Composante', 'Score', 'Poids', 'Contribution']]
    for k, lbl in rv_lbls.items():
        v = rv.get(k, 0)
        p = poids[k]
        comp_data.append([lbl, str(v), f'{int(p*100)}%', str(round(v * p, 1))])
    comp_data.append(['Score 8D total', str(score_8d), '100%', str(score_8d)])

    comp_table = Table(comp_data, colWidths=[W*0.4, W*0.2, W*0.2, W*0.2])
    ts4 = [
        ('BACKGROUND', (0,0), (-1,0), C_INK),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('ROWBACKGROUNDS', (0,1), (-1,-2), [colors.white, C_GRAY]),
        ('GRID', (0,0), (-1,-1), 0.3, C_BORD),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('BACKGROUND', (0,-1), (-1,-1), feu_bgcol),
        ('TEXTCOLOR', (0,-1), (-1,-1), feu_col),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
    ]
    comp_table.setStyle(TableStyle(ts4))
    story.append(comp_table)

    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width=W, thickness=0.5, color=C_BORD, spaceAfter=4, spaceBefore=4))
    story.append(P(
        f'QSSE-Wx · A89 Chantier autoroutier · Rapport généré le {now.strftime("%d/%m/%Y à %H:%M")} par {session["user"]["prenom"]} {session["user"]["nom"]}',
        'Normal', fontSize=7, textColor=colors.HexColor('#9aa3b0'), alignment=TA_CENTER,
    ))

    doc.build(story)
    buf.seek(0)

    from flask import send_file
    filename = f'QSSE-Wx_Rapport_{now.strftime("%B%Y").capitalize()}.pdf'
    rh = db.get_conn()
    rh.execute('INSERT INTO report_history (type,label,filename,generated_by,generated_at) VALUES (?,?,?,?,?)',
               ('pdf', 'Rapport mensuel PDF', filename,
                session['user']['prenom'] + ' ' + session['user']['nom'],
                now.strftime('%Y-%m-%d %H:%M')))
    rh.commit(); rh.close()
    return send_file(buf, mimetype='application/pdf',
                     as_attachment=True, download_name=filename)


# ── EXPORT EXCEL ─────────────────────────────────────────────────

@app.route('/api/rapport/xlsx')
@login_required
def api_rapport_xlsx():
    from io import BytesIO
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    conn = db.get_conn()
    inds      = conn.execute('SELECT * FROM indicateurs ORDER BY rang, id').fetchall()
    actions   = conn.execute('SELECT * FROM actions ORDER BY date_creation DESC').fetchall()
    incidents = conn.execute('SELECT * FROM incidents ORDER BY date DESC').fetchall()
    users     = conn.execute('SELECT id,prenom,nom,email,role,domaine,actif,derniere_cnx FROM users').fetchall()
    rv_row    = conn.execute("SELECT valeur FROM settings WHERE cle='revue_scores'").fetchone()
    tftg      = conn.execute('SELECT * FROM tf_tg_history ORDER BY annee ASC, id ASC LIMIT 12').fetchall()
    conn.close()

    rv = json.loads(rv_row['valeur']) if rv_row else {'perf':78,'risque':66,'crit':41,'cloture':52,'arb':55}
    poids_rv = {'perf':.30,'risque':.25,'crit':.20,'cloture':.15,'arb':.10}
    score_8d = round(sum(rv.get(k,0)*v for k,v in poids_rv.items()), 1)

    active = [i for i in inds if i['statut'] != 'na' and i['score'] is not None]
    total_poids = sum(float(i['poids']) for i in active) or 1.0
    indice_global = round(sum(float(i['score'])*float(i['poids'])/total_poids for i in active)*100, 1) if active else 0.0

    wb = openpyxl.Workbook()
    now = datetime.now()
    today_date = now.date()
    mois = now.strftime('%B %Y').capitalize()

    C_INK_HEX  = '1a1d23'
    C_RED_HEX  = 'A32D2D'
    C_REDL_HEX = 'FCEBEB'
    C_ORA_HEX  = '854F0B'
    C_ORAL_HEX = 'FAEEDA'
    C_GRN_HEX  = '3B6D11'
    C_GRNL_HEX = 'EAF3DE'
    C_BLU_HEX  = '185FA5'
    C_GRAY_HEX = 'f6f8fa'
    C_YELL_HEX = 'BA7517'

    STATUS_COLORS_HEX = {
        'nc_critique': (C_RED_HEX, C_REDL_HEX),
        'nc_majeure': (C_ORA_HEX, C_ORAL_HEX),
        'nc_mineure': (C_YELL_HEX, 'FAEEDA'),
        'conforme': (C_GRN_HEX, C_GRNL_HEX),
        'na': ('6b7591', 'f0f2f5'),
    }
    STATUS_LBL = {'nc_critique':'NC critique','nc_majeure':'NC majeure','nc_mineure':'NC mineure','conforme':'Conforme','na':'N/A'}

    def header_style(cell, bg=C_INK_HEX):
        cell.font = Font(bold=True, color='FFFFFF', size=9)
        cell.fill = PatternFill('solid', fgColor=bg)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    def thin_border():
        s = Side(style='thin', color='e4e7ec')
        return Border(left=s, right=s, top=s, bottom=s)

    def auto_width(ws, min_w=8, max_w=40):
        for col in ws.columns:
            max_len = max((len(str(c.value or '')) for c in col), default=0)
            ws.column_dimensions[get_column_letter(col[0].column)].width = min(max(max_len + 2, min_w), max_w)

    # ── Onglet 1 : Indicateurs ──────────────────────────────────
    ws1 = wb.active
    ws1.title = 'Indicateurs'
    ws1.freeze_panes = 'A2'
    headers1 = ['ID','Domaine','Zone','Libellé','Bloquant','Régl.','Statut','Score','Pts Risque','Rang','Poids','Poids actif','Indice prio.','Rang prio.','Perte pondérée']
    for c, h in enumerate(headers1, 1):
        cell = ws1.cell(1, c, h); header_style(cell)
    for row_i, i in enumerate(inds, 2):
        pa = i['poids_actif'] if i['poids_actif'] is not None else 0
        ip = i['indice_priorite'] if i['indice_priorite'] is not None else 0
        rp = i['rang_priorite'] if i['rang_priorite'] is not None else ''
        pp = i['perte_ponderee'] if i['perte_ponderee'] is not None else 0
        vals = [i['id'],i['domaine'],i['zone'],i['libelle'],'Oui' if i['bloquant'] else 'Non',
                'Oui' if i['reglementaire'] else 'Non',
                STATUS_LBL.get(i['statut'],i['statut']),
                round(float(i['score']),2) if i['score'] is not None else '',
                i['points_risque'], i['rang'] or '', i['poids'],
                round(float(pa),4), round(float(ip),2), rp, round(float(pp),4)]
        fg_hex, bg_hex = STATUS_COLORS_HEX.get(i['statut'], ('333333', 'FFFFFF'))
        for c, v in enumerate(vals, 1):
            cell = ws1.cell(row_i, c, v)
            cell.border = thin_border()
            cell.font = Font(size=9)
            cell.alignment = Alignment(vertical='center')
            if c == 7:
                cell.font = Font(size=9, bold=True, color=fg_hex)
                cell.fill = PatternFill('solid', fgColor=bg_hex)
    auto_width(ws1)

    # ── Onglet 2 : Plan d'actions ───────────────────────────────
    ws2 = wb.create_sheet("Plan d'actions")
    ws2.freeze_panes = 'A2'
    headers2 = ['ID','Source','Libellé','Domaine','Responsable','Délai','Avancement','Statut','Priorité','Date création','Prochaine revue','Commentaire pilote']
    for c, h in enumerate(headers2, 1):
        cell = ws2.cell(1, c, h); header_style(cell)
    for row_i, a in enumerate(actions, 2):
        is_late = a['delai'] and a['statut'] != 'cloturee' and datetime.strptime(a['delai'],'%Y-%m-%d').date() < today_date
        pr = a['prochaine_revue'] if a['prochaine_revue'] else ''
        cp = a['commentaire_pilote'] if a['commentaire_pilote'] else ''
        vals = [a['id'],a['source_id'],a['libelle'],a['domaine'],a['responsable'],
                a['delai'],f"{a['avancement']}%",
                {'ouverte':'Ouverte','en_cours':'En cours','en_attente':'En attente','cloturee':'Clôturée'}.get(a['statut'],a['statut']),
                (a['priorite'] or '').capitalize(), a['date_creation'], pr, cp]
        PRIO_FG = {'critique': C_RED_HEX, 'majeure': C_ORA_HEX, 'mineure': C_YELL_HEX}
        for c, v in enumerate(vals, 1):
            cell = ws2.cell(row_i, c, v)
            cell.border = thin_border()
            cell.font = Font(size=9, color=C_RED_HEX if is_late and c==6 else '000000',
                             bold=is_late and c==6)
            cell.alignment = Alignment(vertical='center')
            if c == 9:
                cell.font = Font(size=9, bold=True, color=PRIO_FG.get(a['priorite'] or '', '333333'))
        if is_late:
            for c in range(1, 13):
                ws2.cell(row_i, c).fill = PatternFill('solid', fgColor=C_REDL_HEX)
    auto_width(ws2)

    # ── Onglet 3 : Incidents ────────────────────────────────────
    ws3 = wb.create_sheet('Incidents')
    ws3.freeze_panes = 'A2'
    headers3 = ['ID','Date','Zone','Type','Gravité','Jours arrêt','Description','Cause','Responsable','Statut','Action immédiate']
    for c, h in enumerate(headers3, 1):
        cell = ws3.cell(1, c, h); header_style(cell)
    GRAV_FG = {'grave': C_RED_HEX, 'modere': C_ORA_HEX, 'mineur': C_GRN_HEX}
    GRAV_BG = {'grave': C_REDL_HEX, 'modere': C_ORAL_HEX, 'mineur': C_GRNL_HEX}
    GRAV_LBL_MAP = {'grave':'Grave','modere':'Modéré','mineur':'Mineur'}
    for row_i, i in enumerate(incidents, 2):
        ai = i['action_immediate'] if i['action_immediate'] else ''
        vals = [i['id'],i['date'],i['zone'],i['type'],GRAV_LBL_MAP.get(i['gravite'],i['gravite']),
                i['jours_arret'],i['description'],i['cause'],i['responsable'],
                {'investigation':'Investigation','en_cours':'En cours','cloture':'Clôturé','ouvert':'Ouvert'}.get(i['statut'],i['statut']),
                ai]
        fg = GRAV_FG.get(i['gravite'], '333333')
        bg = GRAV_BG.get(i['gravite'], 'FFFFFF')
        for c, v in enumerate(vals, 1):
            cell = ws3.cell(row_i, c, v)
            cell.border = thin_border()
            cell.font = Font(size=9)
            cell.alignment = Alignment(vertical='center', wrap_text=(c==7))
            if c == 5:
                cell.font = Font(size=9, bold=True, color=fg)
                cell.fill = PatternFill('solid', fgColor=bg)
    auto_width(ws3)

    # ── Onglet 4 : TF/TG Mensuel ────────────────────────────────
    ws4 = wb.create_sheet('TF-TG Mensuel')
    ws4.freeze_panes = 'A2'
    headers4 = ['Mois','Année','Heures travaillées','Nb accidents','Jours arrêt','TF (×10⁶h)','TG (×10³h)']
    for c, h in enumerate(headers4, 1):
        cell = ws4.cell(1, c, h); header_style(cell)
    for row_i, t in enumerate(tftg, 2):
        vals = [t['mois'],t['annee'],t['heures_travaillees'],t['nb_accidents'],t['jours_arret'],
                round(float(t['tf']),2),round(float(t['tg']),3)]
        for c, v in enumerate(vals, 1):
            cell = ws4.cell(row_i, c, v)
            cell.border = thin_border()
            cell.font = Font(size=9)
            cell.alignment = Alignment(vertical='center')
            if c == 6 and float(t['tf']) > 0:
                cell.font = Font(size=9, bold=True, color=C_ORA_HEX)
    auto_width(ws4)

    # ── Onglet 5 : Utilisateurs ─────────────────────────────────
    ws5 = wb.create_sheet('Utilisateurs')
    headers5 = ['ID','Prénom','Nom','Email','Rôle','Domaine','Actif','Dernière connexion']
    RLBL_MAP = {'admin':'Administrateur','direction':'Direction','resp_qsse':'Resp. QSSE',
                'chef_chantier':'Chef chantier','resp_domaine':'Resp. domaine','metier':'Métier'}
    for c, h in enumerate(headers5, 1):
        cell = ws5.cell(1, c, h); header_style(cell)
    for row_i, u in enumerate(users, 2):
        vals = [u['id'],u['prenom'],u['nom'],u['email'],RLBL_MAP.get(u['role'],u['role']),
                u['domaine'] or '—','Actif' if u['actif'] else 'Inactif',u['derniere_cnx'] or '—']
        for c, v in enumerate(vals, 1):
            cell = ws5.cell(row_i, c, v)
            cell.border = thin_border()
            cell.font = Font(size=9, color=C_GRN_HEX if (c==7 and u['actif']) else ('6b7591' if c==7 else '000000'))
            cell.alignment = Alignment(vertical='center')
    auto_width(ws5)

    # ── Onglet 6 : Synthèse ──────────────────────────────────────
    ws6 = wb.create_sheet('Synthèse')
    ws6['A1'] = f'QSSE-Wx — Rapport {mois}'
    ws6['A1'].font = Font(bold=True, size=14, color=C_INK_HEX)
    ws6['A2'] = f'Généré le {now.strftime("%d/%m/%Y à %H:%M")}'
    ws6['A2'].font = Font(size=9, color='9aa3b0')
    rows_synth = [
        ('', ''),
        ('KPI', 'Valeur'),
        ('Indice global QSSE-Wx', indice_global),
        ('Score 8D', score_8d),
        ('', ''),
        ('Indicateurs total', len(inds)),
        ('NC critiques', sum(1 for i in inds if i['statut']=='nc_critique')),
        ('NC majeures', sum(1 for i in inds if i['statut']=='nc_majeure')),
        ('NC mineures', sum(1 for i in inds if i['statut']=='nc_mineure')),
        ('Conformes', sum(1 for i in inds if i['statut']=='conforme')),
        ('', ''),
        ('Actions total', len(actions)),
        ('Actions clôturées', sum(1 for a in actions if a['statut']=='cloturee')),
        ("Taux de clôture", f"{round(sum(1 for a in actions if a['statut']=='cloturee')/len(actions)*100) if actions else 0}%"),
        ('Actions en retard', sum(1 for a in actions if a['statut']!='cloturee' and a['delai'] and datetime.strptime(a['delai'],'%Y-%m-%d').date()<today_date)),
        ('', ''),
        ('Incidents total', len(incidents)),
        ('Incidents graves', sum(1 for i in incidents if i['gravite']=='grave')),
    ]
    for r, (k, v) in enumerate(rows_synth, 4):
        bold_keys = ('KPI','Indice global QSSE-Wx','Score 8D','Actions total','Indicateurs total','Incidents total')
        ws6.cell(r, 1, k).font = Font(size=9, bold=(k in bold_keys))
        ws6.cell(r, 2, v).font = Font(size=9, bold=True, color=C_BLU_HEX if isinstance(v,(int,float)) else '000000')
    ws6.column_dimensions['A'].width = 28
    ws6.column_dimensions['B'].width = 15

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    from flask import send_file
    filename = f"QSSE-Wx_Export_{now.strftime('%B%Y').capitalize()}.xlsx"
    rh = db.get_conn()
    rh.execute('INSERT INTO report_history (type,label,filename,generated_by,generated_at) VALUES (?,?,?,?,?)',
               ('xlsx', 'Export Excel complet', filename,
                session['user']['prenom'] + ' ' + session['user']['nom'],
                now.strftime('%Y-%m-%d %H:%M')))
    rh.commit(); rh.close()
    return send_file(buf, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                     as_attachment=True, download_name=filename)


@app.route('/api/report_history')
@login_required
def api_report_history():
    conn = db.get_conn()
    rows = conn.execute(
        'SELECT * FROM report_history ORDER BY id DESC LIMIT 50'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/report_history/<int:entry_id>', methods=['DELETE'])
@login_required
def api_delete_report_history(entry_id):
    if session['user']['role'] != 'admin':
        return jsonify({'error': 'Accès réservé aux administrateurs'}), 403
    conn = db.get_conn()
    conn.execute('DELETE FROM report_history WHERE id=?', (entry_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── UPLOAD ENDPOINTS ─────────────────────────────────────────────

@app.route('/api/upload/avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier'}), 400
    f = request.files['file']
    if not f.filename or not _allowed_img(f.filename):
        return jsonify({'error': 'Format non autorisé (jpg/png/webp)'}), 400
    user_id = session['user_id']
    ext = f.filename.rsplit('.', 1)[1].lower()
    filename = f'avatar_{secure_filename(user_id)}.{ext}'
    # Remove old avatar with different extension
    for old in os.listdir(os.path.join(UPLOAD_FOLDER, 'avatars')):
        if old.startswith(f'avatar_{secure_filename(user_id)}.') and old != filename:
            try:
                os.remove(os.path.join(UPLOAD_FOLDER, 'avatars', old))
            except Exception:
                pass
    f.save(os.path.join(UPLOAD_FOLDER, 'avatars', filename))
    photo_url = f'/static/uploads/avatars/{filename}'
    conn = db.get_conn()
    conn.execute('UPDATE users SET photo_url=? WHERE id=?', (photo_url, user_id))
    conn.commit()
    conn.close()
    # Update session
    session['user']['photo_url'] = photo_url
    session.modified = True
    return jsonify({'ok': True, 'url': photo_url})


def _load_site_urls(conn):
    row = conn.execute("SELECT valeur FROM settings WHERE cle='site_photos_json'").fetchone()
    if row:
        return json.loads(row['valeur'])
    # migrate legacy single-photo setting
    old = conn.execute("SELECT valeur FROM settings WHERE cle='site_photo_url'").fetchone()
    return [old['valeur']] if old else []

def _save_site_urls(conn, urls):
    if urls:
        conn.execute("INSERT INTO settings (cle,valeur) VALUES ('site_photos_json',?) ON CONFLICT (cle) DO UPDATE SET valeur=excluded.valeur", (json.dumps(urls),))
    else:
        conn.execute("DELETE FROM settings WHERE cle='site_photos_json'")
    conn.execute("DELETE FROM settings WHERE cle='site_photo_url'")


@app.route('/api/upload/site', methods=['POST'])
@login_required
def upload_site():
    if session.get('role') not in ('admin', 'direction', 'resp_qsse'):
        return jsonify({'error': 'Non autorisé'}), 403
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier'}), 400
    f = request.files['file']
    if not f.filename or not _allowed_img(f.filename):
        return jsonify({'error': 'Format non autorisé (jpg/png/webp)'}), 400
    ext = f.filename.rsplit('.', 1)[1].lower()
    filename = f'site_{uuid.uuid4().hex[:10]}.{ext}'
    site_dir = os.path.join(UPLOAD_FOLDER, 'site')
    f.save(os.path.join(site_dir, filename))
    url = f'/static/uploads/site/{filename}'
    conn = db.get_conn()
    urls = _load_site_urls(conn)
    if len(urls) >= 8:
        return jsonify({'error': 'Maximum 8 photos atteint'}), 400
    urls.append(url)
    _save_site_urls(conn, urls)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'urls': urls})


@app.route('/api/site-photos')
@login_required
def get_site_photos():
    conn = db.get_conn()
    urls = _load_site_urls(conn)
    conn.close()
    return jsonify({'urls': urls})


@app.route('/api/upload/media', methods=['POST'])
@login_required
def upload_media():
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier'}), 400
    f = request.files['file']
    if not f.filename or not _allowed_img(f.filename):
        return jsonify({'error': 'Format non autorisé (jpg/png/webp)'}), 400
    if len(f.read()) > 10 * 1024 * 1024:
        return jsonify({'error': 'Fichier trop lourd (max 10 Mo)'}), 400
    f.seek(0)
    ext = f.filename.rsplit('.', 1)[1].lower()
    filename = f'{uuid.uuid4().hex[:12]}.{ext}'
    media_dir = os.path.join(UPLOAD_FOLDER, 'media')
    os.makedirs(media_dir, exist_ok=True)
    f.save(os.path.join(media_dir, filename))
    return jsonify({'ok': True, 'url': f'/static/uploads/media/{filename}'})


@app.route('/api/upload/site/delete', methods=['POST'])
@login_required
def delete_site_photo():
    if session.get('role') not in ('admin', 'direction', 'resp_qsse'):
        return jsonify({'error': 'Non autorisé'}), 403
    data = request.get_json(silent=True) or {}
    target_url = data.get('url')
    site_dir = os.path.join(UPLOAD_FOLDER, 'site')
    conn = db.get_conn()
    urls = _load_site_urls(conn)
    if target_url:
        if target_url in urls:
            urls.remove(target_url)
        fname = target_url.split('/')[-1]
        try:
            os.remove(os.path.join(site_dir, fname))
        except Exception:
            pass
    else:
        for u in urls:
            try:
                os.remove(os.path.join(site_dir, u.split('/')[-1]))
            except Exception:
                pass
        urls = []
    _save_site_urls(conn, urls)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'urls': urls})


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=debug, host='0.0.0.0', port=port)
