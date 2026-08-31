// ── INTERNATIONALISATION ──────────────────────────────────────────
let LANG = localStorage.getItem('lang') || 'fr';

const TRANSLATIONS = {
  fr: {
    // Navigation groupes
    'nav.grp.pilotage': 'Pilotage',
    'nav.grp.decision': 'Décision & Rapports',
    'nav.grp.admin': 'Administration',
    // Navigation items
    'nav.dashboard': 'Tableau de bord',
    'nav.indicateurs': 'Indicateurs',
    'nav.saisie': 'Saisie terrain',
    'nav.actions': "Plan d'actions",
    'nav.incidents': 'Incidents',
    'nav.decision': 'Matrice 8D',
    'nav.revue': 'Revue hebdo. 8D',
    'nav.reporting': 'Reporting',
    'nav.users': 'Utilisateurs',
    'nav.notifications': 'Notifications',
    'nav.parametres': 'Paramètres',
    // Titres de pages
    'page.dashboard': 'Tableau de bord',
    'page.indicateurs': 'Indicateurs — 120 référentiels',
    'page.saisie': 'Saisie terrain',
    'page.actions': "Plan d'actions",
    'page.incidents': 'Registre des incidents',
    'page.decision': 'Matrice de décision 8D',
    'page.revue': 'Revue hebdomadaire 8D',
    'page.reporting': 'Reporting & Exports',
    'page.users': 'Utilisateurs & Rôles',
    'page.notifications': 'Notifications & Alertes',
    'page.parametres': 'Paramètres',
    // KPI labels
    'kpi.total': 'Total',
    'kpi.closure_rate': 'Taux clôture',
    'kpi.overdue': 'En retard',
    'kpi.review7d': 'Revue <7j',
    'kpi.tf': 'TF',
    'kpi.tg': 'TG',
    'kpi.days_no_acc': 'Jours sans acc.',
    'kpi.inc_month': 'Incidents (mois)',
    'kpi.unread': 'Non lues',
    'kpi.active_jobs': 'Jobs actifs',
    'kpi.next_review': 'Prochaine revue',
    // En-têtes de colonnes
    'th.id': 'ID', 'th.action': 'Action', 'th.domain': 'Dom.',
    'th.resp': 'Resp.', 'th.deadline': 'Délai', 'th.progress': 'Avancement',
    'th.status': 'Statut', 'th.priority': 'Priorité', 'th.date': 'Date',
    'th.zone': 'Zone', 'th.type': 'Type', 'th.gravity': 'Gravité',
    'th.days_stop': 'J.A.', 'th.description': 'Description', 'th.cause': 'Cause',
    'th.label': 'Libellé', 'th.score': 'Score', 'th.risk': 'Risque',
    'th.rank': 'Rang', 'th.blocking': 'Bloquant', 'th.actions_col': 'Actions',
    'th.user': 'Utilisateur', 'th.email': 'Email', 'th.role': 'Rôle',
    'th.last_cnx': 'Dernière cnx.', 'th.report': 'Rapport', 'th.file': 'Fichier',
    'th.generated_by': 'Généré par', 'th.format': 'Format',
    'th.job': 'Job', 'th.cron': 'Cron',
    'th.score8d': 'Score 8D', 'th.index': 'Indice', 'th.risk2': 'Risque',
    'th.light': 'Feu', 'th.decision': 'Décision', 'th.validator': 'Validateur',
    // Boutons
    'btn.save': 'Enregistrer', 'btn.cancel': 'Annuler', 'btn.add': 'Ajouter',
    'btn.new_action': 'Nouvelle action', 'btn.declare_incident': 'Déclarer incident',
    'btn.enter_obs': 'Saisir obs.', 'btn.logout': 'Se déconnecter',
    'btn.generate_pdf': 'Générer PDF →', 'btn.export_xlsx': 'Exporter XLSX →',
    'btn.generate': 'Générer →', 'btn.mark_all_read': 'Tout marquer lu',
    'btn.delete_all': 'Tout supprimer', 'btn.validate_review': 'Valider la revue',
    'btn.save_review': 'Enregistrer la revue', 'btn.update': 'Mettre à jour',
    'btn.reset': 'Réinitialiser', 'btn.back': 'Retour',
    'btn.create_user': "Créer l'utilisateur", 'btn.create_action': "Créer l'action",
    'btn.see_all': 'Voir tout →', 'btn.detail': 'Détail →', 'btn.plan': 'Plan →',
    // Titres de modals
    'modal.declare_incident': 'Déclarer un incident',
    'modal.edit_action': "Modifier l'action",
    'modal.add_user': 'Ajouter un utilisateur',
    'modal.new_action': 'Nouvelle action corrective',
    // Labels de formulaires
    'lbl.indicator': 'Indicateur', 'lbl.observed_status': 'Statut observé',
    'lbl.comment': 'Commentaire', 'lbl.date': 'Date', 'lbl.zone': 'Zone',
    'lbl.type': 'Type', 'lbl.gravity': 'Gravité', 'lbl.days_stop': 'Jours arrêt',
    'lbl.responsible': 'Responsable', 'lbl.description': 'Description',
    'lbl.probable_cause': 'Cause probable', 'lbl.progress': 'Avancement (%)',
    'lbl.status': 'Statut', 'lbl.next_review': 'Prochaine revue',
    'lbl.pilot_comment': 'Commentaire pilote', 'lbl.identified_cause': 'Cause identifiée',
    'lbl.immediate_action': 'Action immédiate', 'lbl.firstname': 'Prénom *',
    'lbl.lastname': 'Nom *', 'lbl.email': 'Email *', 'lbl.role': 'Rôle *',
    'lbl.temp_pwd': 'Mot de passe temporaire *', 'lbl.source_indicator': 'Indicateur source',
    'lbl.action_label': "Libellé de l'action *", 'lbl.domain': 'Domaine *',
    'lbl.target_deadline': 'Délai cible *', 'lbl.priority': 'Priorité',
    // Filtres
    'filter.all_statuses': 'Tous statuts', 'filter.all_priorities': 'Toutes priorités',
    'filter.all_gravities': 'Toutes gravités', 'filter.all_domains': 'Tous domaines',
    'filter.all_roles': 'Tous les rôles', 'filter.overdue': 'En retard',
    'filter.search_placeholder': 'Rechercher...', 'filter.search_user': 'Nom, email, rôle...',
    'filter.all_statuses2': 'Tous statuts',
    // Statuts
    'status.open': 'Ouverte', 'status.in_progress': 'En cours',
    'status.on_hold': 'En attente', 'status.closed_f': 'Clôturée',
    'status.closed_m': 'Clôturé', 'status.investigation': 'Investigation',
    'status.active': 'Actif', 'status.inactive': 'Inactif',
    // Priorités
    'priority.critical': 'Critique', 'priority.major': 'Majeure', 'priority.minor': 'Mineure',
    // Gravités
    'gravity.grave': 'Grave', 'gravity.modere': 'Modéré', 'gravity.mineur': 'Mineur',
    // Profil dropdown
    'profile.role': 'Rôle', 'profile.id': 'Identifiant', 'profile.last_cnx': 'Dernière cnx.',
    // Paramètres
    'settings.score_scales': 'Barèmes des scores',
    'settings.8d_weights': 'Poids composantes 8D',
    'settings.qsse_thresholds': 'Seuils indice QSSE-Wx',
    'settings.site': 'Chantier',
    'settings.green_threshold': 'Seuil vert (≥)',
    'settings.orange_threshold': 'Seuil orange (≥)',
    'settings.red_threshold': 'Seuil rouge (<)',
    'settings.closure_target': 'Taux clôture cible (%)',
    'settings.hours_month': 'Heures trav. / mois',
    'settings.readonly_msg': "Lecture seule — seul l'administrateur peut modifier ces paramètres.",
    // Dashboard
    'dash.perf_domain': 'Performance par domaine',
    'dash.auto_decision': 'Décision automatique',
    'dash.priority_actions': 'Actions prioritaires',
    'dash.recent_incidents': 'Incidents récents',
    'dash.status_dist': 'Répartition des statuts',
    'dash.closure_rate': 'Taux clôture',
    'dash.closure_target': 'Cible 80%',
    // Reporting
    'rpt.monthly_pdf': 'Rapport mensuel PDF',
    'rpt.monthly_pdf_sub': 'Synthèse · domaines · actions · TF/TG',
    'rpt.excel': 'Export Excel 5 onglets',
    'rpt.excel_sub': 'Indicateurs · actions · incidents · utilisateurs · synthèse',
    'rpt.tftg': 'Tableau TF/TG mensuel',
    'rpt.tftg_sub': 'Historique · fréquence · gravité',
    'rpt.history': 'Historique des exports',
    // Sections
    'sec.quick_update': 'Mise à jour rapide',
    'sec.details_tracking': 'Détails & suivi',
    'sec.calc_info': 'Informations calculées',
    'sec.calc_engine': 'Calculs moteur',
    'sec.related_actions': 'Actions liées',
    'sec.review_history': 'Historique des revues',
    'sec.alert_rules': "Règles d'alerte",
    'sec.scheduled_jobs': 'Jobs planifiés',
    'sec.decision_history': 'Historique des décisions',
    'sec.8d_components': 'Composantes 8D',
    'sec.recommendations': 'Recommandations',
    'sec.8d_scores': 'Saisie des scores 8D',
    'sec.calc_decision': 'Décision calculée',
    'sec.score_components': 'Composantes du score',
    'sec.auto_recs': 'Recommandations automatiques',
    // Divers
    'misc.loading': 'Chargement…',
    'misc.no_export': 'Aucun export pour le moment',
    'misc.no_notif': 'Aucune notification',
    'misc.no_action': 'Aucune action',
    'misc.no_incident': 'Aucun incident',
    'misc.history': 'Historique',
    'misc.calculated_score': 'Score 8D calculé',
    'btn.save_obs': "Enregistrer l'observation",
    'btn.back_list': 'Retour liste',
    'btn.back_actions': "Retour plan d'actions",
    'btn.back_register': 'Retour registre',
    'btn.list': 'Liste',
    'btn.enter_obs2': 'Saisir obs.',
    'nav.grp.pilotage': 'Pilotage',
    'nav.grp.decision': 'Décision & Rapports',
    'nav.grp.admin': 'Administration',
  },
  en: {
    'nav.grp.pilotage': 'Monitoring',
    'nav.grp.decision': 'Decision & Reports',
    'nav.grp.admin': 'Administration',
    'nav.dashboard': 'Dashboard',
    'nav.indicateurs': 'Indicators',
    'nav.saisie': 'Field Entry',
    'nav.actions': 'Action Plan',
    'nav.incidents': 'Incidents',
    'nav.decision': '8D Matrix',
    'nav.revue': '8D Weekly Review',
    'nav.reporting': 'Reporting',
    'nav.users': 'Users',
    'nav.notifications': 'Notifications',
    'nav.parametres': 'Settings',
    'page.dashboard': 'Dashboard',
    'page.indicateurs': 'Indicators — 120 references',
    'page.saisie': 'Field Entry',
    'page.actions': 'Action Plan',
    'page.incidents': 'Incident Register',
    'page.decision': '8D Decision Matrix',
    'page.revue': '8D Weekly Review',
    'page.reporting': 'Reporting & Exports',
    'page.users': 'Users & Roles',
    'page.notifications': 'Notifications & Alerts',
    'page.parametres': 'Settings',
    'kpi.total': 'Total', 'kpi.closure_rate': 'Closure rate',
    'kpi.overdue': 'Overdue', 'kpi.review7d': 'Review <7d',
    'kpi.tf': 'FR', 'kpi.tg': 'SR',
    'kpi.days_no_acc': 'Days w/o acc.', 'kpi.inc_month': 'Incidents (month)',
    'kpi.unread': 'Unread', 'kpi.active_jobs': 'Active jobs', 'kpi.next_review': 'Next review',
    'th.id': 'ID', 'th.action': 'Action', 'th.domain': 'Dom.',
    'th.resp': 'Resp.', 'th.deadline': 'Deadline', 'th.progress': 'Progress',
    'th.status': 'Status', 'th.priority': 'Priority', 'th.date': 'Date',
    'th.zone': 'Zone', 'th.type': 'Type', 'th.gravity': 'Severity',
    'th.days_stop': 'L.D.', 'th.description': 'Description', 'th.cause': 'Cause',
    'th.label': 'Label', 'th.score': 'Score', 'th.risk': 'Risk',
    'th.rank': 'Rank', 'th.blocking': 'Blocking', 'th.actions_col': 'Actions',
    'th.user': 'User', 'th.email': 'Email', 'th.role': 'Role',
    'th.last_cnx': 'Last login', 'th.report': 'Report', 'th.file': 'File',
    'th.generated_by': 'Generated by', 'th.format': 'Format',
    'th.job': 'Job', 'th.cron': 'Cron',
    'th.score8d': '8D Score', 'th.index': 'Index', 'th.risk2': 'Risk',
    'th.light': 'Light', 'th.decision': 'Decision', 'th.validator': 'Validator',
    'btn.save': 'Save', 'btn.cancel': 'Cancel', 'btn.add': 'Add',
    'btn.new_action': 'New action', 'btn.declare_incident': 'Report incident',
    'btn.enter_obs': 'Enter obs.', 'btn.logout': 'Sign out',
    'btn.generate_pdf': 'Generate PDF →', 'btn.export_xlsx': 'Export XLSX →',
    'btn.generate': 'Generate →', 'btn.mark_all_read': 'Mark all read',
    'btn.delete_all': 'Delete all', 'btn.validate_review': 'Submit review',
    'btn.save_review': 'Save review', 'btn.update': 'Update',
    'btn.reset': 'Reset', 'btn.back': 'Back',
    'btn.create_user': 'Create user', 'btn.create_action': 'Create action',
    'btn.see_all': 'See all →', 'btn.detail': 'Detail →', 'btn.plan': 'Plan →',
    'modal.declare_incident': 'Report an incident',
    'modal.edit_action': 'Edit action',
    'modal.add_user': 'Add a user',
    'modal.new_action': 'New corrective action',
    'lbl.indicator': 'Indicator', 'lbl.observed_status': 'Observed status',
    'lbl.comment': 'Comment', 'lbl.date': 'Date', 'lbl.zone': 'Zone',
    'lbl.type': 'Type', 'lbl.gravity': 'Severity', 'lbl.days_stop': 'Lost days',
    'lbl.responsible': 'Responsible', 'lbl.description': 'Description',
    'lbl.probable_cause': 'Probable cause', 'lbl.progress': 'Progress (%)',
    'lbl.status': 'Status', 'lbl.next_review': 'Next review',
    'lbl.pilot_comment': 'Pilot comment', 'lbl.identified_cause': 'Identified cause',
    'lbl.immediate_action': 'Immediate action', 'lbl.firstname': 'First name *',
    'lbl.lastname': 'Last name *', 'lbl.email': 'Email *', 'lbl.role': 'Role *',
    'lbl.temp_pwd': 'Temporary password *', 'lbl.source_indicator': 'Source indicator',
    'lbl.action_label': 'Action label *', 'lbl.domain': 'Domain *',
    'lbl.target_deadline': 'Target deadline *', 'lbl.priority': 'Priority',
    'filter.all_statuses': 'All statuses', 'filter.all_priorities': 'All priorities',
    'filter.all_gravities': 'All severities', 'filter.all_domains': 'All domains',
    'filter.all_roles': 'All roles', 'filter.overdue': 'Overdue',
    'filter.search_placeholder': 'Search...', 'filter.search_user': 'Name, email, role...',
    'filter.all_statuses2': 'All statuses',
    'status.open': 'Open', 'status.in_progress': 'In progress',
    'status.on_hold': 'On hold', 'status.closed_f': 'Closed',
    'status.closed_m': 'Closed', 'status.investigation': 'Investigation',
    'status.active': 'Active', 'status.inactive': 'Inactive',
    'priority.critical': 'Critical', 'priority.major': 'Major', 'priority.minor': 'Minor',
    'gravity.grave': 'Serious', 'gravity.modere': 'Moderate', 'gravity.mineur': 'Minor',
    'profile.role': 'Role', 'profile.id': 'ID', 'profile.last_cnx': 'Last login',
    'settings.score_scales': 'Score scales',
    'settings.8d_weights': '8D component weights',
    'settings.qsse_thresholds': 'QSSE-Wx index thresholds',
    'settings.site': 'Site',
    'settings.green_threshold': 'Green threshold (≥)',
    'settings.orange_threshold': 'Orange threshold (≥)',
    'settings.red_threshold': 'Red threshold (<)',
    'settings.closure_target': 'Closure rate target (%)',
    'settings.hours_month': 'Working hours / month',
    'settings.readonly_msg': 'Read only — only the administrator can modify these settings.',
    'dash.perf_domain': 'Performance by domain',
    'dash.auto_decision': 'Automatic decision',
    'dash.priority_actions': 'Priority actions',
    'dash.recent_incidents': 'Recent incidents',
    'dash.status_dist': 'Status distribution',
    'dash.closure_rate': 'Closure rate',
    'dash.closure_target': 'Target 80%',
    'rpt.monthly_pdf': 'Monthly PDF Report',
    'rpt.monthly_pdf_sub': 'Summary · domains · actions · FR/SR',
    'rpt.excel': 'Excel Export 5 sheets',
    'rpt.excel_sub': 'Indicators · actions · incidents · users · summary',
    'rpt.tftg': 'Monthly FR/SR table',
    'rpt.tftg_sub': 'History · frequency · severity',
    'rpt.history': 'Export history',
    'sec.quick_update': 'Quick update',
    'sec.details_tracking': 'Details & tracking',
    'sec.calc_info': 'Calculated information',
    'sec.calc_engine': 'Engine calculations',
    'sec.related_actions': 'Related actions',
    'sec.review_history': 'Review history',
    'sec.alert_rules': 'Alert rules',
    'sec.scheduled_jobs': 'Scheduled jobs',
    'sec.decision_history': 'Decision history',
    'sec.8d_components': '8D components',
    'sec.recommendations': 'Recommendations',
    'sec.8d_scores': '8D score entry',
    'sec.calc_decision': 'Calculated decision',
    'sec.score_components': 'Score components',
    'sec.auto_recs': 'Automatic recommendations',
    'misc.loading': 'Loading…',
    'misc.no_export': 'No exports yet',
    'misc.no_notif': 'No notifications',
    'misc.no_action': 'No actions',
    'misc.no_incident': 'No incidents',
    'misc.history': 'History',
    'misc.calculated_score': 'Calculated 8D score',
    'btn.save_obs': 'Save observation',
    'btn.back_list': 'Back to list',
    'btn.back_actions': 'Back to actions',
    'btn.back_register': 'Back to register',
    'btn.list': 'List',
    'btn.enter_obs2': 'Enter obs.',
    'nav.grp.pilotage': 'Monitoring',
    'nav.grp.decision': 'Decision & Reports',
    'nav.grp.admin': 'Administration',
  }
};

function t(key) {
  return (TRANSLATIONS[LANG] || TRANSLATIONS.fr)[key] || key;
}

function setLang(lang) {
  LANG = lang;
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  _applyLangBtn();
}

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    const v = t(k);
    if (v === k) return;
    if (el.querySelector('i,svg')) {
      const last = el.lastChild;
      if (last && last.nodeType === 3) last.textContent = v;
      else el.appendChild(document.createTextNode(v));
    } else {
      el.textContent = v;
    }
  });
  // Labels nav-item via data-page
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const lbl = el.querySelector('.nav-lbl');
    const key = 'nav.' + el.dataset.page;
    if (lbl && t(key) !== key) lbl.textContent = t(key);
  });
  // Titre de la page active
  const activePage = document.querySelector('.nav-item.on[data-page]');
  if (activePage) {
    const pt = document.getElementById('PT');
    if (pt) pt.textContent = t('page.' + activePage.dataset.page);
  }
  // Placeholders
  const placeholders = {
    'SRCH':    t('filter.search_placeholder'),
    'U-SRCH':  t('filter.search_user'),
    'OBS-CMT': t('lbl.comment'),
    'EM-CMT':  t('lbl.comment'),
    'IM-DESC': LANG === 'en' ? 'Describe the incident...' : "Décrivez l'incident...",
    'IM-CAUSE':LANG === 'en' ? 'Identified cause...' : 'Cause identifiée...',
    'FA-CMT':  LANG === 'en' ? 'Follow-up comment...' : 'Commentaire de suivi...',
    'FI-CAUSE-INP': LANG === 'en' ? 'Identified cause...' : 'Cause identifiée...',
    'FI-AI-INP':    LANG === 'en' ? 'Immediate action taken...' : 'Action immédiate prise...',
  };
  Object.entries(placeholders).forEach(([id, ph]) => {
    const el = document.getElementById(id);
    if (el) el.placeholder = ph;
  });
}

function _applyLangBtn() {
  const btn = document.getElementById('LANG-BTN');
  if (btn) btn.textContent = LANG === 'fr' ? 'EN' : 'FR';
}

function toggleLang() {
  setLang(LANG === 'fr' ? 'en' : 'fr');
}
