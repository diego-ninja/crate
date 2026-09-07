import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  isMobilePlaybackRuntime,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  setPlaybackDeliveryPolicyPreference,
  setInfinitePlaybackPreference,
  setCrossfadeDurationPreference,
  setSmartCrossfadePreference,
  setSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import {
  getEqualizerEnabled,
  setEqualizerEnabled,
} from "@/lib/equalizer-prefs";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  RangeRow,
  Section,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";

const PLAYBACK_DELIVERY_OPTIONS: {
  value: PlaybackDeliveryPreference;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    value: "auto",
    labelKey: "settings.playback.delivery.auto",
    descriptionKey: "settings.playback.delivery.autoDescription",
  },
  {
    value: "balanced",
    labelKey: "settings.playback.delivery.balanced",
    descriptionKey: "settings.playback.delivery.balancedDescription",
  },
  {
    value: "original",
    labelKey: "settings.playback.delivery.original",
    descriptionKey: "settings.playback.delivery.originalDescription",
  },
  {
    value: "data_saver",
    labelKey: "settings.playback.delivery.dataSaver",
    descriptionKey: "settings.playback.delivery.dataSaverDescription",
  },
];

export function PlaybackSection() {
  const { t } = useTranslation();
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(
    getCrossfadeDurationPreference,
  );
  const [smartCrossfadeEnabled, setSmartCrossfadeEnabled] = useState(
    getSmartCrossfadePreference,
  );
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(
    getInfinitePlaybackPreference,
  );
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] =
    useState(getSmartPlaylistSuggestionsPreference);
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] =
    useState(getSmartPlaylistSuggestionsCadencePreference);
  const [playbackDeliveryPolicy, setPlaybackDeliveryPolicy] = useState(
    getPlaybackDeliveryPolicyPreference,
  );
  const mobilePlaybackRuntime = isMobilePlaybackRuntime();
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const [equalizerEnabled, setEqualizerEnabledState] = useState(() =>
    getEqualizerEnabled(androidNativePlayerEnabled),
  );

  return (
    <Section
      title={t("settings.playback.title")}
      description={t("settings.playback.subtitle")}
    >
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium text-text-primary">
            {t("settings.playback.streamQuality")}
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {t("settings.playback.streamQualityDescription")}
          </p>
        </div>
        <div
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          role="radiogroup"
          aria-label={t("settings.playback.streamQuality")}
        >
          {PLAYBACK_DELIVERY_OPTIONS.map((option) => {
            const selected = playbackDeliveryPolicy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setPlaybackDeliveryPolicy(option.value);
                  setPlaybackDeliveryPolicyPreference(option.value);
                }}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
                    : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {t(option.labelKey)}
                </span>
                <span className="mt-1 block text-xs text-text-muted">
                  {t(option.descriptionKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <ToggleRow
        label={t("settings.playback.infinitePlayback")}
        description={t("settings.playback.infinitePlaybackDescription")}
        checked={infinitePlaybackEnabled}
        onChange={(value) => {
          setInfinitePlaybackEnabled(value);
          setInfinitePlaybackPreference(value);
        }}
      />
      {!mobilePlaybackRuntime ? (
        <>
          <ToggleRow
            label={t("settings.playback.smartTransitions")}
            description={t("settings.playback.smartTransitionsDescription")}
            checked={smartCrossfadeEnabled}
            onChange={(value) => {
              setSmartCrossfadeEnabled(value);
              setSmartCrossfadePreference(value);
            }}
          />
          <RangeRow
            label={t("settings.playback.crossfade")}
            description={t("settings.playback.crossfadeDescription")}
            value={crossfadeSeconds}
            min={0}
            max={12}
            step={1}
            displayValue={
              crossfadeSeconds === 0
                ? t("common.off")
                : t("common.secondsShort", { count: crossfadeSeconds })
            }
            onChange={(value) => {
              setCrossfadeSeconds(value);
              setCrossfadeDurationPreference(value);
            }}
          />
        </>
      ) : null}
      {!mobilePlaybackRuntime || androidNativePlayerEnabled ? (
        <ToggleRow
          label={t("player.equalizer")}
          checked={equalizerEnabled}
          onChange={(value) => {
            setEqualizerEnabledState(value);
            setEqualizerEnabled(value);
          }}
        />
      ) : null}
      <ToggleRow
        label={t("settings.playback.smartPlaylistSuggestions")}
        description={t("settings.playback.smartPlaylistSuggestionsDescription")}
        checked={smartPlaylistSuggestionsEnabled}
        onChange={(value) => {
          setSmartPlaylistSuggestionsEnabled(value);
          setSmartPlaylistSuggestionsPreference(value);
        }}
      />
      <RangeRow
        label={t("settings.playback.suggestionCadence")}
        description={t("settings.playback.suggestionCadenceDescription")}
        value={smartPlaylistSuggestionsCadence}
        min={2}
        max={10}
        step={1}
        displayValue={t("settings.playback.suggestionCadenceValue", {
          count: smartPlaylistSuggestionsCadence,
        })}
        disabled={!smartPlaylistSuggestionsEnabled}
        onChange={(value) => {
          setSmartPlaylistSuggestionsCadence(value);
          setSmartPlaylistSuggestionsCadencePreference(value);
        }}
      />
    </Section>
  );
}
