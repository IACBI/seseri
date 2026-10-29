/**
 * The sleep-timer control, shared by the Now Playing sheet and the mini dock.
 *
 * Both surfaces used to own a `<select>` and mirror the other by reaching across
 * the DOM with `getElementById`. Each now just renders this, driven by the
 * `sleepState` signal, so they cannot disagree.
 */

import { currentLang, t } from '../i18n';
import { fmtTime } from '../lib/format';
import {
  cancelSleepTimer,
  extendSleepTimer,
  setSleepEndOfEpisode,
  setSleepMinutes,
} from '../player/sleep-timer';
import { sleepState, SLEEP_PRESETS, type SleepState } from '../state/sleep';
import { fitSelect } from './fit-select';
import { numberPrompt } from './number-prompt';
import { toast } from './toast';

/** Sentinel option values that are not a plain minute count. */
const VAL_EPISODE = 'ep';
const VAL_CUSTOM = 'custom';
const DEFAULT_CUSTOM_MINUTES = 45;
/** Floor for the fitted select, so a short "Off" still reads as a control and not a gap. */
const SLEEP_MIN_WIDTH_PX = 46;

export interface SleepControlEls {
  select: HTMLSelectElement;
  /** Live countdown readout (optional — the mini dock has no room). */
  countdown?: HTMLElement;
  /** "+5 min" button (optional). */
  extend?: HTMLButtonElement;
}

export function initSleepControl(els: SleepControlEls): void {
  const { select, countdown, extend } = els;

  function buildOptions(): void {
    select.replaceChildren();
    for (const n of SLEEP_PRESETS) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = n === 0 ? t('sleep_off_short') : `${n} ${t('dur_m')}`;
      select.appendChild(o);
    }
    const epOpt = document.createElement('option');
    epOpt.value = VAL_EPISODE;
    epOpt.textContent = t('sleep_end_of_episode');
    select.appendChild(epOpt);

    const customOpt = document.createElement('option');
    customOpt.value = VAL_CUSTOM;
    customOpt.textContent = t('sleep_custom');
    select.appendChild(customOpt);
  }

  /** Reflect state into the select, the active styling and the countdown. */
  function apply(s: SleepState): void {
    if (s.mode === 'off') select.value = '0';
    else if (s.mode === 'episode') select.value = VAL_EPISODE;
    else {
      // A custom duration may not be one of the presets; add it on demand so
      // the select can actually display it.
      const val = String(s.minutes);
      if (!Array.from(select.options).some((o) => o.value === val)) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = `${s.minutes} ${t('dur_m')}`;
        select.insertBefore(o, select.options[SLEEP_PRESETS.length] ?? null);
      }
      select.value = val;
    }

    select.classList.toggle('active', s.mode !== 'off');
    // "End of episode" is by far the longest option, and a native select is
    // always as wide as its widest one — which left a 120px box reading "Off".
    fitSelect(select, SLEEP_MIN_WIDTH_PX);

    if (countdown) {
      if (s.mode === 'minutes') {
        countdown.textContent = fmtTime(s.remainingMs / 1000) + (s.held ? ' ⏸' : '');
        countdown.hidden = false;
      } else if (s.mode === 'episode') {
        countdown.textContent = t('sleep_end_of_episode');
        countdown.hidden = false;
      } else {
        countdown.textContent = '';
        countdown.hidden = true;
      }
    }
    if (extend) extend.hidden = s.mode !== 'minutes';
  }

  select.addEventListener('change', () => {
    const raw = select.value;
    if (raw === VAL_EPISODE) {
      setSleepEndOfEpisode();
      toast(t('sleep_set_episode'));
      return;
    }
    if (raw === VAL_CUSTOM) {
      void (async () => {
        const n = await numberPrompt({
          titleKey: 'sleep_timer',
          labelKey: 'sleep_custom_label',
          min: 1,
          max: 600,
          initial: DEFAULT_CUSTOM_MINUTES,
        });
        if (n === null) {
          apply(sleepState()); // dismissed — restore the previous selection
          return;
        }
        setSleepMinutes(n);
        toast(t('sleep_set', n));
      })();
      return;
    }
    const min = parseInt(raw, 10) || 0;
    if (min <= 0) {
      cancelSleepTimer();
      toast(t('sleep_off'));
      return;
    }
    setSleepMinutes(min);
    toast(t('sleep_set', min));
  });

  extend?.addEventListener('click', () => {
    extendSleepTimer();
    toast(t('sleep_extended'));
  });

  buildOptions();
  currentLang.subscribe(() => {
    buildOptions();
    apply(sleepState());
  });
  sleepState.subscribe(apply);
  apply(sleepState());
  // The mono face lands after first paint and changes what the label measures.
  void document.fonts?.ready.then(() => apply(sleepState()));
}
