"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type FormValues = {
  baselineRate: string;
  minDetectableUplift: string;
  significance: string;
  power: string;
  dailyVisitors: string;
  variantTraffic: string;
};

type Result = {
  sampleSizePerGroup: number;
  totalSampleSize: number;
  durationDays: number;
  expectedVariantRate: number;
};

type ParsedValues = {
  baselineRate: number;
  uplift: number;
  significance: number;
  power: number;
  dailyVisitors: number;
  variantTraffic: number;
};

type FeatureToggle = {
  id: string;
  name: string;
  enabled: boolean;
  rollout: number;
  description: string;
};

type SavedScenario = {
  id: string;
  name: string;
  values: FormValues;
  createdAt: string;
};

type TrackerValues = {
  controlUsers: string;
  variantUsers: string;
};

type ReadinessCheck = {
  label: string;
  passed: boolean;
};

type ReadinessSummary = {
  score: number;
  level: "Ready" | "Needs Review" | "Risky";
  checks: ReadinessCheck[];
};

const DEFAULT_VALUES: FormValues = {
  baselineRate: "8",
  minDetectableUplift: "10",
  significance: "5",
  power: "80",
  dailyVisitors: "12000",
  variantTraffic: "50",
};

const FORM_VALUE_KEYS: (keyof FormValues)[] = [
  "baselineRate",
  "minDetectableUplift",
  "significance",
  "power",
  "dailyVisitors",
  "variantTraffic",
];

const DEFAULT_TOGGLES: FeatureToggle[] = [
  {
    id: "quick-withdrawal",
    name: "Quick Withdrawal CTA",
    enabled: true,
    rollout: 100,
    description: "Shows a faster withdrawal call-to-action on cashier screens.",
  },
  {
    id: "new-lobby-banner",
    name: "New Lobby Promo Banner",
    enabled: false,
    rollout: 20,
    description: "Tests a new homepage banner for high-value campaign traffic.",
  },
];

const TOGGLES_STORAGE_KEY = "ab-test-planner-feature-toggles";
const SCENARIOS_STORAGE_KEY = "ab-test-planner-saved-scenarios";
const THEME_STORAGE_KEY = "ab-test-planner-theme";
const DEFAULT_TRACKER_VALUES: TrackerValues = {
  controlUsers: "0",
  variantUsers: "0",
};

function inverseNormalCdf(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error("Probability must be between 0 and 1.");
  }

  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;

  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;

  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;

  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (probability < pLow) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }

  if (probability > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }

  const q = probability - 0.5;
  const r = q * q;
  return (
    (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function parseValues(values: FormValues): ParsedValues {
  return {
    baselineRate: Number(values.baselineRate) / 100,
    uplift: Number(values.minDetectableUplift) / 100,
    significance: Number(values.significance) / 100,
    power: Number(values.power) / 100,
    dailyVisitors: Number(values.dailyVisitors),
    variantTraffic: Number(values.variantTraffic) / 100,
  };
}

function valuesFromSearchParams(searchParams: { get: (key: string) => string | null }): FormValues {
  const initialValues: FormValues = { ...DEFAULT_VALUES };

  for (const key of FORM_VALUE_KEYS) {
    const param = searchParams.get(key);
    if (param && param.trim() !== "") {
      initialValues[key] = param;
    }
  }

  return initialValues;
}

function valuesToQueryString(values: FormValues): string {
  const params = new URLSearchParams();
  for (const key of FORM_VALUE_KEYS) {
    params.set(key, values[key]);
  }
  return params.toString();
}

function readInitialValuesFromLocation(): FormValues {
  if (typeof window === "undefined") {
    return DEFAULT_VALUES;
  }

  const params = new URLSearchParams(window.location.search);
  return valuesFromSearchParams(params);
}

function readTogglesFromStorage(): FeatureToggle[] {
  if (typeof window === "undefined") {
    return DEFAULT_TOGGLES;
  }

  const raw = window.localStorage.getItem(TOGGLES_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_TOGGLES;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_TOGGLES;
    }

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        enabled: Boolean(item.enabled),
        rollout: Math.max(0, Math.min(100, Number(item.rollout) || 0)),
        description: String(item.description ?? ""),
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return DEFAULT_TOGGLES;
  }
}

function readScenariosFromStorage(): SavedScenario[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(SCENARIOS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        values: {
          baselineRate: String(item.values?.baselineRate ?? DEFAULT_VALUES.baselineRate),
          minDetectableUplift: String(
            item.values?.minDetectableUplift ?? DEFAULT_VALUES.minDetectableUplift,
          ),
          significance: String(item.values?.significance ?? DEFAULT_VALUES.significance),
          power: String(item.values?.power ?? DEFAULT_VALUES.power),
          dailyVisitors: String(item.values?.dailyVisitors ?? DEFAULT_VALUES.dailyVisitors),
          variantTraffic: String(item.values?.variantTraffic ?? DEFAULT_VALUES.variantTraffic),
        },
        createdAt: String(item.createdAt ?? new Date().toISOString()),
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

function readThemeFromStorage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark";
}

function calculateResult(parsed: ParsedValues): Result {
  const p1 = parsed.baselineRate;
  const p2 = p1 * (1 + parsed.uplift);
  const alpha = parsed.significance;
  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zBeta = inverseNormalCdf(parsed.power);

  const pooled = (p1 + p2) / 2;
  const diff = Math.abs(p2 - p1);

  const numerator =
    zAlpha * Math.sqrt(2 * pooled * (1 - pooled)) +
    zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));

  const sampleSizePerGroup = Math.ceil((numerator * numerator) / (diff * diff));

  const controlShare = 1 - parsed.variantTraffic;
  const variantShare = parsed.variantTraffic;

  const controlDaily = parsed.dailyVisitors * controlShare;
  const variantDaily = parsed.dailyVisitors * variantShare;

  const durationDays = Math.ceil(
    Math.max(sampleSizePerGroup / controlDaily, sampleSizePerGroup / variantDaily),
  );

  return {
    sampleSizePerGroup,
    totalSampleSize: sampleSizePerGroup * 2,
    durationDays,
    expectedVariantRate: p2,
  };
}

function buildReadinessSummary(values: FormValues, result: Result): ReadinessSummary {
  const significance = Number(values.significance);
  const power = Number(values.power);
  const expectedUplift = Number(values.minDetectableUplift);
  const variantTraffic = Number(values.variantTraffic);

  const checks: ReadinessCheck[] = [
    {
      label: "Run at least 7 days to cover weekday behavior",
      passed: result.durationDays >= 7,
    },
    {
      label: "Traffic split stays near balanced (40% to 60% for B)",
      passed: variantTraffic >= 40 && variantTraffic <= 60,
    },
    {
      label: "Confidence strictness is strong (10% or lower)",
      passed: significance <= 10,
    },
    {
      label: "Detection chance is solid (80% or higher)",
      passed: power >= 80,
    },
    {
      label: "Sample size per variant is robust (1,000+)",
      passed: result.sampleSizePerGroup >= 1000,
    },
    {
      label: "Expected lift target is realistic (30% or lower)",
      passed: expectedUplift <= 30,
    },
  ];

  const penalty = checks.reduce((sum, check) => sum + (check.passed ? 0 : 15), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const level = score >= 85 ? "Ready" : score >= 65 ? "Needs Review" : "Risky";

  return { score, level, checks };
}

function buildExperimentBrief(
  values: FormValues,
  result: Result,
  readiness: ReadinessSummary | null,
  toggles: FeatureToggle[],
): string {
  const activeToggles = toggles.filter((toggle) => toggle.enabled);
  const checks = readiness
    ? readiness.checks
        .map((check) => `- [${check.passed ? "x" : " "}] ${check.label}`)
        .join("\n")
    : "- No readiness checks available";

  const activeToggleLines =
    activeToggles.length > 0
      ? activeToggles
          .map((toggle) => `- ${toggle.name} (${toggle.rollout}% rollout)`)
          .join("\n")
      : "- None";

  return [
    "A/B TEST EXPERIMENT BRIEF",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "Assumptions",
    `- Current conversion rate: ${values.baselineRate}%`,
    `- Expected improvement: ${values.minDetectableUplift}%`,
    `- Confidence strictness: ${values.significance}%`,
    `- Chance to detect real lift: ${values.power}%`,
    `- Users per day: ${values.dailyVisitors}`,
    `- Traffic to version B: ${values.variantTraffic}%`,
    "",
    "Estimated Results",
    `- Sample size per variant: ${formatNumber(result.sampleSizePerGroup)} users`,
    `- Total sample size: ${formatNumber(result.totalSampleSize)} users`,
    `- Estimated duration: ${result.durationDays} day(s)`,
    `- Expected conversion rate (B): ${formatRate(result.expectedVariantRate)}`,
    "",
    "Launch Readiness",
    readiness ? `- Score: ${readiness.score}/100 (${readiness.level})` : "- Score: N/A",
    checks,
    "",
    "Active Feature Toggles",
    activeToggleLines,
  ].join("\n");
}

export default function Home() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => readThemeFromStorage());
  const [values, setValues] = useState<FormValues>(() => readInitialValuesFromLocation());
  const [errors, setErrors] = useState<Record<keyof FormValues, string>>({
    baselineRate: "",
    minDetectableUplift: "",
    significance: "",
    power: "",
    dailyVisitors: "",
    variantTraffic: "",
  });
  const [globalError, setGlobalError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [briefStatus, setBriefStatus] = useState("");
  const [toggles, setToggles] = useState<FeatureToggle[]>(() => readTogglesFromStorage());
  const [scenarios, setScenarios] = useState<SavedScenario[]>(() => readScenariosFromStorage());
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioStatus, setScenarioStatus] = useState("");
  const [trackerValues, setTrackerValues] = useState<TrackerValues>(DEFAULT_TRACKER_VALUES);
  const [trackerError, setTrackerError] = useState("");
  const [newToggleName, setNewToggleName] = useState("");
  const [newToggleDescription, setNewToggleDescription] = useState("");
  const [toggleError, setToggleError] = useState("");
  const [result, setResult] = useState<Result | null>(() =>
    calculateResult(parseValues(readInitialValuesFromLocation())),
  );

  const hasErrors = useMemo(() => {
    return Object.values(errors).some(Boolean) || Boolean(globalError);
  }, [errors, globalError]);
  const readiness = useMemo(() => {
    return result ? buildReadinessSummary(values, result) : null;
  }, [result, values]);
  const trackerSummary = useMemo(() => {
    if (!result) {
      return null;
    }

    const controlUsers = Number(trackerValues.controlUsers);
    const variantUsers = Number(trackerValues.variantUsers);
    if (
      !Number.isFinite(controlUsers) ||
      !Number.isFinite(variantUsers) ||
      controlUsers < 0 ||
      variantUsers < 0
    ) {
      return null;
    }

    const required = result.sampleSizePerGroup;
    const controlProgress = Math.min(100, (controlUsers / required) * 100);
    const variantProgress = Math.min(100, (variantUsers / required) * 100);
    const controlRemaining = Math.max(0, required - controlUsers);
    const variantRemaining = Math.max(0, required - variantUsers);

    const dailyVisitors = Number(values.dailyVisitors);
    const variantTrafficShare = Number(values.variantTraffic) / 100;
    const controlDaily = dailyVisitors * (1 - variantTrafficShare);
    const variantDaily = dailyVisitors * variantTrafficShare;

    const controlDaysLeft = controlDaily > 0 ? controlRemaining / controlDaily : Number.POSITIVE_INFINITY;
    const variantDaysLeft = variantDaily > 0 ? variantRemaining / variantDaily : Number.POSITIVE_INFINITY;
    const estimatedDaysLeft = Number.isFinite(Math.max(controlDaysLeft, variantDaysLeft))
      ? Math.ceil(Math.max(controlDaysLeft, variantDaysLeft))
      : null;
    const isReady = controlRemaining <= 0 && variantRemaining <= 0;

    return {
      required,
      controlUsers,
      variantUsers,
      controlProgress,
      variantProgress,
      controlRemaining,
      variantRemaining,
      estimatedDaysLeft,
      isReady,
    };
  }, [result, trackerValues, values.dailyVisitors, values.variantTraffic]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(TOGGLES_STORAGE_KEY, JSON.stringify(toggles));
  }, [toggles]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
  }, [scenarios]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    document.documentElement.classList.toggle("dark", isDarkMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  function validate(nextValues: FormValues) {
    const nextErrors: Record<keyof FormValues, string> = {
      baselineRate: "",
      minDetectableUplift: "",
      significance: "",
      power: "",
      dailyVisitors: "",
      variantTraffic: "",
    };

    const baselineRate = Number(nextValues.baselineRate);
    const uplift = Number(nextValues.minDetectableUplift);
    const significance = Number(nextValues.significance);
    const power = Number(nextValues.power);
    const dailyVisitors = Number(nextValues.dailyVisitors);
    const variantTraffic = Number(nextValues.variantTraffic);

    if (!Number.isFinite(baselineRate) || baselineRate <= 0 || baselineRate >= 100) {
      nextErrors.baselineRate = "Enter a value between 0 and 100 (exclusive).";
    }

    if (!Number.isFinite(uplift) || uplift <= 0 || uplift > 500) {
      nextErrors.minDetectableUplift = "Enter uplift between 0 and 500%.";
    }

    if (!Number.isFinite(significance) || significance <= 0 || significance >= 50) {
      nextErrors.significance = "Enter significance between 0 and 50 (exclusive).";
    }

    if (!Number.isFinite(power) || power <= 50 || power >= 99.9) {
      nextErrors.power = "Enter power between 50 and 99.9 (exclusive).";
    }

    if (!Number.isFinite(dailyVisitors) || dailyVisitors < 1 || !Number.isInteger(dailyVisitors)) {
      nextErrors.dailyVisitors = "Enter an integer >= 1.";
    }

    if (!Number.isFinite(variantTraffic) || variantTraffic <= 0 || variantTraffic >= 100) {
      nextErrors.variantTraffic = "Enter a value between 0 and 100 (exclusive).";
    }

    const expectedVariantRate = (baselineRate / 100) * (1 + uplift / 100);
    const nextGlobalError =
      Number.isFinite(expectedVariantRate) && expectedVariantRate >= 1
        ? "Expected variant conversion rate reaches or exceeds 100%. Lower baseline or uplift."
        : "";

    return {
      nextErrors,
      nextGlobalError,
      parsed: {
        baselineRate: baselineRate / 100,
        uplift: uplift / 100,
        significance: significance / 100,
        power: power / 100,
        dailyVisitors,
        variantTraffic: variantTraffic / 100,
      },
    };
  }

  function runCalculation(nextValues: FormValues) {
    const { nextErrors, nextGlobalError, parsed } = validate(nextValues);
    setErrors(nextErrors);
    setGlobalError(nextGlobalError);

    const hasFieldErrors = Object.values(nextErrors).some(Boolean);
    if (hasFieldErrors || nextGlobalError) {
      setResult(null);
      return;
    }

    setResult(calculateResult(parsed));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runCalculation(values);
  }

  function updateValue<K extends keyof FormValues>(key: K, value: string) {
    const nextValues = { ...values, [key]: value };
    setValues(nextValues);
    setShareStatus("");
    setBriefStatus("");

    if (result || hasErrors) {
      runCalculation(nextValues);
    }
  }

  async function handleShareLink() {
    const query = valuesToQueryString(values);
    const pathWithQuery = `${window.location.pathname}?${query}`;
    window.history.replaceState(null, "", pathWithQuery);

    try {
      const fullUrl = `${window.location.origin}${pathWithQuery}`;
      await navigator.clipboard.writeText(fullUrl);
      setShareStatus("Share link copied.");
    } catch {
      setShareStatus("Share link added to URL bar.");
    }
  }

  function handleResetDefaults() {
    const resetValues = { ...DEFAULT_VALUES };
    setValues(resetValues);
    setShareStatus("");
    setBriefStatus("");
    setScenarioStatus("");
    setTrackerValues(DEFAULT_TRACKER_VALUES);
    setTrackerError("");
    runCalculation(resetValues);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function handleCopyBrief() {
    if (!result) {
      return;
    }

    const brief = buildExperimentBrief(values, result, readiness, toggles);
    try {
      await navigator.clipboard.writeText(brief);
      setBriefStatus("Experiment brief copied.");
    } catch {
      setBriefStatus("Copy failed. Please try again.");
    }
  }

  function addToggle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newToggleName.trim();
    if (!name) {
      setToggleError("Toggle name is required.");
      return;
    }

    setToggles((current) => [
      {
        id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        name,
        enabled: false,
        rollout: 0,
        description: newToggleDescription.trim(),
      },
      ...current,
    ]);
    setNewToggleName("");
    setNewToggleDescription("");
    setToggleError("");
  }

  function updateToggle<K extends keyof FeatureToggle>(id: string, key: K, value: FeatureToggle[K]) {
    setToggles((current) => current.map((toggle) => (toggle.id === id ? { ...toggle, [key]: value } : toggle)));
  }

  function removeToggle(id: string) {
    setToggles((current) => current.filter((toggle) => toggle.id !== id));
  }

  function saveScenario() {
    const name = scenarioName.trim();
    if (!name) {
      setScenarioStatus("Scenario name is required.");
      return;
    }

    const item: SavedScenario = {
      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      name,
      values: { ...values },
      createdAt: new Date().toISOString(),
    };

    setScenarios((current) => [item, ...current].slice(0, 12));
    setScenarioName("");
    setScenarioStatus("Scenario saved.");
  }

  function loadScenario(scenario: SavedScenario) {
    setValues(scenario.values);
    runCalculation(scenario.values);
    setScenarioStatus(`Loaded "${scenario.name}".`);
  }

  function deleteScenario(id: string) {
    setScenarios((current) => current.filter((scenario) => scenario.id !== id));
    setScenarioStatus("Scenario removed.");
  }

  function updateTrackerValue<K extends keyof TrackerValues>(key: K, value: string) {
    const numeric = Number(value);
    if (value.trim() !== "" && (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric))) {
      setTrackerError("Tracker fields must be integers greater than or equal to 0.");
    } else {
      setTrackerError("");
    }

    setTrackerValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-10">
        <header className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">A/B Test Planner</h1>
            <button
              type="button"
              onClick={() => setIsDarkMode((current) => !current)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {isDarkMode ? "Switch to Light" : "Switch to Dark"}
            </button>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Plan your A/B test for iGaming product changes. Enter your expected numbers and get how many users
            you need and how long the test may run.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <InputField
              id="baselineRate"
              label="Current conversion rate (%)"
              tooltip="How many users convert today before any change (your A version)."
              value={values.baselineRate}
              error={errors.baselineRate}
              onChange={(value) => updateValue("baselineRate", value)}
            />

            <InputField
              id="minDetectableUplift"
              label="Expected improvement (%)"
              tooltip="Smallest lift you want to be able to catch in B. Smaller lifts need more users."
              value={values.minDetectableUplift}
              error={errors.minDetectableUplift}
              onChange={(value) => updateValue("minDetectableUplift", value)}
            />

            <InputField
              id="significance"
              label="Confidence strictness (%)"
              tooltip="How strict you want to be before calling a winner. More strict means more users."
              value={values.significance}
              error={errors.significance}
              onChange={(value) => updateValue("significance", value)}
            />

            <InputField
              id="power"
              label="Chance to detect real lift (%)"
              tooltip="How likely the test should catch a true improvement. Higher chance means more users."
              value={values.power}
              error={errors.power}
              onChange={(value) => updateValue("power", value)}
            />

            <InputField
              id="dailyVisitors"
              label="Users per day"
              tooltip="Average number of users per day who can join this test."
              value={values.dailyVisitors}
              error={errors.dailyVisitors}
              onChange={(value) => updateValue("dailyVisitors", value)}
            />

            <InputField
              id="variantTraffic"
              label="Traffic to version B (%)"
              tooltip="How much traffic goes to B. A very uneven split can make the test take longer."
              value={values.variantTraffic}
              error={errors.variantTraffic}
              onChange={(value) => updateValue("variantTraffic", value)}
            />

            {globalError ? (
              <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {globalError}
              </p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              Calculate Sample Size & Duration
            </button>

            <button
              type="button"
              onClick={handleShareLink}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Share URL
            </button>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Reset to Defaults
            </button>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Saved Scenarios
              </p>
              <div className="flex gap-2">
                <input
                  value={scenarioName}
                  onChange={(event) => {
                    setScenarioName(event.target.value);
                    if (scenarioStatus) {
                      setScenarioStatus("");
                    }
                  }}
                  placeholder="Scenario name"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
                />
                <button
                  type="button"
                  onClick={saveScenario}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  Save
                </button>
              </div>
            </div>

            {shareStatus ? <p className="text-xs text-slate-600 dark:text-slate-300">{shareStatus}</p> : null}
            {briefStatus ? <p className="text-xs text-slate-600 dark:text-slate-300">{briefStatus}</p> : null}
            {scenarioStatus ? <p className="text-xs text-slate-600 dark:text-slate-300">{scenarioStatus}</p> : null}
          </form>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              Results
              <TooltipHelp text="We estimate required users for A and B, then convert that into days using your daily traffic and split." />
            </h2>
            {!result ? (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                Enter your assumptions and calculate to see required sample size and estimated run time.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                <ResultCard
                  label="Sample size per variant"
                  value={`${formatNumber(result.sampleSizePerGroup)} users`}
                  tooltip="Calculated with a two-group conversion formula using your current rate, expected improvement, confidence strictness, and detection chance. Output is users needed in each group."
                />
                <ResultCard
                  label="Total sample size"
                  value={`${formatNumber(result.totalSampleSize)} users`}
                  tooltip="Total sample = sample per variant x 2 (A + B)."
                />
                <ResultCard
                  label="Estimated duration"
                  value={`${result.durationDays} day(s)`}
                  tooltip="Control daily users = users per day x (1 - B traffic). B daily users = users per day x B traffic. Days = larger of (sample per variant / control daily) and (sample per variant / B daily), rounded up."
                />
                <ResultCard
                  label="Expected conversion rate (variant B)"
                  value={formatRate(result.expectedVariantRate)}
                  tooltip="Expected B rate = current conversion rate x (1 + expected improvement)."
                />
                {readiness ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Launch Readiness Score</p>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          readiness.level === "Ready"
                            ? "bg-emerald-100 text-emerald-700"
                            : readiness.level === "Needs Review"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {readiness.level}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{readiness.score}/100</p>
                    <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className={`h-2 rounded-full ${
                          readiness.level === "Ready"
                            ? "bg-emerald-500"
                            : readiness.level === "Needs Review"
                              ? "bg-amber-500"
                              : "bg-rose-500"
                        }`}
                        style={{ width: `${readiness.score}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1">
                      {readiness.checks.map((check) => (
                        <p key={check.label} className="text-xs text-slate-600 dark:text-slate-300">
                          <span className={check.passed ? "text-emerald-600" : "text-rose-600"}>
                            {check.passed ? "PASS" : "CHECK"}
                          </span>{" "}
                          {check.label}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="pt-3 text-xs text-slate-500 dark:text-slate-400">
                  Estimate only. Use it as planning guidance before running the live test.
                </p>
                <button
                  type="button"
                  onClick={handleCopyBrief}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Copy Experiment Brief
                </button>
              </div>
            )}
          </section>
        </div>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
          <h2 className="text-xl font-semibold">Live Experiment Progress Tracker</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Enter users already collected in A and B to see progress toward required sample size and expected
            days left.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
              <span>Current users in A (Control)</span>
              <input
                type="number"
                min={0}
                value={trackerValues.controlUsers}
                onChange={(event) => updateTrackerValue("controlUsers", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
              />
            </label>
            <label className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
              <span>Current users in B (Variant)</span>
              <input
                type="number"
                min={0}
                value={trackerValues.variantUsers}
                onChange={(event) => updateTrackerValue("variantUsers", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
              />
            </label>
          </div>

          {trackerError ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{trackerError}</p> : null}

          {result && trackerSummary ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Required Per Variant
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {formatNumber(trackerSummary.required)} users
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">A (Control) Progress</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {formatNumber(trackerSummary.controlUsers)} collected |{" "}
                  {formatNumber(trackerSummary.controlRemaining)} remaining
                </p>
                <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-2 rounded-full bg-sky-500"
                    style={{ width: `${trackerSummary.controlProgress}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">B (Variant) Progress</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {formatNumber(trackerSummary.variantUsers)} collected |{" "}
                  {formatNumber(trackerSummary.variantRemaining)} remaining
                </p>
                <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${trackerSummary.variantProgress}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Current Status</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {trackerSummary.isReady
                    ? "Sample complete. You can analyze the experiment."
                    : trackerSummary.estimatedDaysLeft !== null
                      ? `Estimated ${trackerSummary.estimatedDaysLeft} day(s) left to hit both targets.`
                      : "Unable to estimate days left with current traffic setup."}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
          <h2 className="text-xl font-semibold">Scenario Library</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Save assumptions you use often and reload them instantly for faster planning.
          </p>

          {scenarios.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No scenarios yet. Save one from the planner form.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {scenarios.map((scenario) => (
                <div key={scenario.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{scenario.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Baseline {scenario.values.baselineRate}% | Uplift {scenario.values.minDetectableUplift}% |
                        Power {scenario.values.power}% | Traffic B {scenario.values.variantTraffic}%
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => loadScenario(scenario)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteScenario(scenario.id)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
          <h2 className="text-xl font-semibold">Feature Toggle Management</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Track launch flags, quickly adjust rollout percentage, and control whether each feature is live.
          </p>

          <form className="mt-5 grid gap-3 md:grid-cols-3" onSubmit={addToggle}>
            <input
              value={newToggleName}
              onChange={(event) => {
                setNewToggleName(event.target.value);
                if (toggleError) {
                  setToggleError("");
                }
              }}
              placeholder="Toggle name"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
            />
            <input
              value={newToggleDescription}
              onChange={(event) => setNewToggleDescription(event.target.value)}
              placeholder="Short description (optional)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 md:col-span-2"
            />
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 md:col-span-3 md:w-fit"
            >
              Add Toggle
            </button>
          </form>
          {toggleError ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{toggleError}</p> : null}

          <div className="mt-6 space-y-3">
            {toggles.map((toggle) => (
              <div key={toggle.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{toggle.name}</p>
                    {toggle.description ? (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{toggle.description}</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">No description</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeToggle(toggle.id)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
                    <span>Status</span>
                    <input
                      type="checkbox"
                      checked={toggle.enabled}
                      onChange={(event) => updateToggle(toggle.id, "enabled", event.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>

                  <label className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
                    <span>Rollout (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={toggle.rollout}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        const nextRollout = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
                        updateToggle(toggle.id, "rollout", nextRollout);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

type InputFieldProps = {
  id: string;
  label: string;
  tooltip: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
};

function InputField({ id, label, tooltip, value, error, onChange }: InputFieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </label>
        <TooltipHelp text={tooltip} />
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
          error
            ? "border-rose-500 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200"
            : "border-slate-300 bg-white focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
        }`}
        inputMode="decimal"
      />
      {error ? <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

type ResultCardProps = {
  label: string;
  value: string;
  tooltip?: string;
};

function ResultCard({ label, value, tooltip }: ResultCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {tooltip ? <TooltipHelp text={tooltip} /> : null}
      </div>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

type TooltipHelpProps = {
  text: string;
};

function TooltipHelp({ text }: TooltipHelpProps) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="More info"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold text-slate-600 dark:border-slate-500 dark:text-slate-300"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}
