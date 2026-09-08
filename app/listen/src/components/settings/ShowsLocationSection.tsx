import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Section } from "@/components/settings/SettingsPrimitives";
import {
  FixedCityPicker,
  LocationModePicker,
  RadiusPicker,
  type CityResult,
} from "@/components/settings/ShowsLocationControls";
import { api } from "@/lib/api";

interface LocationData {
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  show_radius_km: number;
  show_location_mode: string;
}

interface DetectedLocation {
  city: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
}

export function ShowsLocationSection() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [mode, setMode] = useState<"fixed" | "near_me">("fixed");
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    api<LocationData>("/api/me/location")
      .then((data) => {
        setLocation(data);
        setMode((data.show_location_mode as "fixed" | "near_me") || "fixed");
        setCity(data.city || "");
        setRadius(data.show_radius_km || 60);
      })
      .catch(() => {});
  }, []);

  const fetchDetectedLocation =
    useCallback(async (): Promise<DetectedLocation> => {
      const geo = await api<DetectedLocation>("/api/me/geolocation");
      await api("/api/me/location", "PUT", {
        city: geo.city,
        country: geo.country,
        country_code: geo.country_code,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
      return geo;
    }, []);

  useEffect(() => {
    if (!location || location.city) return;
    let cancelled = false;
    setDetecting(true);
    void fetchDetectedLocation()
      .then((geo) => {
        if (cancelled) return;
        setCity(geo.city);
        setLocation((previous) => (previous ? { ...previous, ...geo } : null));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDetectedLocation, location]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<CityResult[]>(
        `/api/me/cities/search?q=${encodeURIComponent(searchQuery)}`,
      )
        .then((results) => {
          setSearchResults(results);
          setShowDropdown(true);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const detectFromIp = useCallback(
    async (silent = false) => {
      setDetecting(true);
      try {
        const geo = await fetchDetectedLocation();
        setCity(geo.city);
        setLocation((prev) => (prev ? { ...prev, ...geo } : null));
        if (!silent) {
          toast.success(
            t("settings.shows.toasts.detected", {
              city: geo.city,
              country: geo.country,
            }),
          );
        }
      } catch {
        if (!silent) toast.error(t("settings.shows.toasts.detectFailed"));
      } finally {
        setDetecting(false);
      }
    },
    [fetchDetectedLocation, t],
  );

  function selectCity(result: CityResult) {
    setCity(result.city);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    api("/api/me/location", "PUT", {
      city: result.city,
      country: result.country,
      country_code: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
    })
      .then(() => {
        setLocation((prev) =>
          prev
            ? {
                ...prev,
                city: result.city,
                country: result.country,
                country_code: result.country_code,
                latitude: result.latitude,
                longitude: result.longitude,
              }
            : null,
        );
        toast.success(
          t("settings.shows.toasts.citySet", { city: result.display_name }),
        );
      })
      .catch(() => toast.error(t("settings.shows.toasts.saveCityFailed")));
  }

  async function saveMode(newMode: "fixed" | "near_me") {
    setMode(newMode);
    try {
      await api("/api/me/location", "PUT", { show_location_mode: newMode });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  async function saveRadius(newRadius: number) {
    setRadius(newRadius);
    try {
      await api("/api/me/location", "PUT", { show_radius_km: newRadius });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  const displayCity = city || location?.city;
  const displayCountry = location?.country;

  return (
    <Section
      title={t("settings.shows.title")}
      description={t("settings.shows.description")}
    >
      <LocationModePicker
        mode={mode}
        displayCity={displayCity}
        displayCountry={displayCountry}
        onChange={saveMode}
      />
      {mode === "fixed" ? (
        <FixedCityPicker
          city={city}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searching={searching}
          detecting={detecting}
          showDropdown={showDropdown}
          setCity={setCity}
          setSearchQuery={setSearchQuery}
          setShowDropdown={setShowDropdown}
          detectFromIp={detectFromIp}
          selectCity={selectCity}
        />
      ) : null}
      <RadiusPicker radius={radius} onChange={saveRadius} />
    </Section>
  );
}
