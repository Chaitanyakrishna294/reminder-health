module.exports = {
  FREQUENCIES: {
    once_daily: 'once_daily',
    twice_daily: 'twice_daily',
    thrice_daily: 'thrice_daily'
  },
  
  STATES: {
    DRUG_NAME: 'drug_name',
    DOSAGE: 'dosage',
    TIME: 'time',
    TABLET_COUNT: 'tablet_count',
    REFILL_COUNT: 'refill_count',
    ADD_CAREGIVER_INFO: 'add_caregiver_info',
    EDIT_FIELD: 'edit_field'
  },
  
  CALLBACK_ACTIONS: {
    TAKEN: 'taken',
    SKIP: 'skip',
    SNOOZE: 'snooze',
    FREQ_ONCE: 'freq_once',
    FREQ_TWICE: 'freq_twice',
    FREQ_THRICE: 'freq_thrice',
    MENU_ADD_MED: 'menu_add_med',
    MENU_MY_LOGS: 'menu_my_logs',
    MENU_STATS: 'menu_stats',
    MENU_TODAYS_MEDS: 'menu_todays_meds',
    MENU_SNOOZE: 'menu_snooze',
    MENU_CANCEL: 'menu_cancel',
    MENU_CAREGIVER: 'menu_caregiver',
    MENU_MANAGE: 'menu_manage',
    REFILL_BOUGHT: 'refill_bought',
    REFILL_STOP: 'refill_stop',
    MED_EDIT: 'med_edit',
    MED_DELETE: 'med_delete',
    MED_DEL_CONFIRM: 'med_del_confirm',
    MED_DEL_CANCEL: 'med_del_cancel',
    EDIT_SELECT: 'edit_select',
    ADD_CONFIRM: 'add_confirm',
    ADD_EDIT: 'add_edit',
    PAGE_NEXT: 'page_next',
    PAGE_PREV: 'page_prev',
    CG_TAKEN: 'CG_TAKEN',
    CG_SKIP: 'CG_SKIP',
    CG_PANEL: 'CG_PANEL',
    CG_BECOME: 'CG_BECOME',
    CG_ADD: 'CG_ADD'
  },

  MAIN_MENU: {
    ADD_MED: '➕ Add Medication',
    MY_LOGS: '📝 My Logs',
    STATS: '📊 Stats',
    TODAYS_MEDS: '💊 Today\'s Meds',
    SNOOZE: '⏰ Snooze',
    CANCEL: '❌ Cancel',
    CAREGIVER: '👨⚕ Caregiver',
    MANAGE: '⚙️ Manage'
  },

  SNOOZE_MINUTES: 10,
  MAX_SNOOZES: 3
};
