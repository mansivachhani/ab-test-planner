"use client";

import { FormEvent, useMemo, useState } from "react";

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

const DEFAULT_VALUES: FormValues = {
  baselineRate: "8",
  minDetectableUplift: "10",
  significance: "5",
  power: "80",
  dailyVisitors: "12000",
  variantTraffic: "50",
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

export default function Home() {
  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES);
  const [errors, setErrors] = useState<Record<keyof FormValues, string>>({
    baselineRate: "",
    minDetectableUplift: "",
    significance: "",
    power: "",
    dailyVisitors: "",
    variantTraffic: "",
  });
  const [globalError, setGlobalError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const hasErrors = useMemo(() => {
    return Object.values(errors).some(Boolean) || Boolean(globalError);
  }, [errors, globalError]);

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

    setResult({
      sampleSizePerGroup,
      totalSampleSize: sampleSizePerGroup * 2,
      durationDays,
      expectedVariantRate: p2,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runCalculation(values);
  }

  function updateValue<K extends keyof FormValues>(key: K, value: string) {
    const nextValues = { ...values, [key]: value };
    setValues(nextValues);

    if (result || hasErrors) {
      runCalculation(nextValues);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <main className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">A/B Test Planner</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Plan statistically sound experiments for product changes in iGaming funnels. Adjust assumptions,
            validate inputs, and get sample size plus test duration estimates instantly.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <InputField
              id="baselineRate"
              label="Baseline conversion rate (%)"
              value={values.baselineRate}
              error={errors.baselineRate}
              onChange={(value) => updateValue("baselineRate", value)}
            />

            <InputField
              id="minDetectableUplift"
              label="Minimum detectable uplift (%)"
              value={values.minDetectableUplift}
              error={errors.minDetectableUplift}
              onChange={(value) => updateValue("minDetectableUplift", value)}
            />

            <InputField
              id="significance"
              label="Significance level / alpha (%)"
              value={values.significance}
              error={errors.significance}
              onChange={(value) => updateValue("significance", value)}
            />

            <InputField
              id="power"
              label="Statistical power (%)"
              value={values.power}
              error={errors.power}
              onChange={(value) => updateValue("power", value)}
            />

            <InputField
              id="dailyVisitors"
              label="Daily eligible users"
              value={values.dailyVisitors}
              error={errors.dailyVisitors}
              onChange={(value) => updateValue("dailyVisitors", value)}
            />

            <InputField
              id="variantTraffic"
              label="Traffic allocated to variant B (%)"
              value={values.variantTraffic}
              error={errors.variantTraffic}
              onChange={(value) => updateValue("variantTraffic", value)}
            />

            {globalError ? (
              <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{globalError}</p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Calculate Sample Size & Duration
            </button>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold">Results</h2>
            {!result ? (
              <p className="mt-4 text-sm text-slate-600">
                Enter your assumptions and calculate to see required sample size and estimated run time.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                <ResultCard
                  label="Sample size per variant"
                  value={`${formatNumber(result.sampleSizePerGroup)} users`}
                />
                <ResultCard label="Total sample size" value={`${formatNumber(result.totalSampleSize)} users`} />
                <ResultCard label="Estimated duration" value={`${result.durationDays} day(s)`} />
                <ResultCard
                  label="Expected conversion rate (variant B)"
                  value={formatRate(result.expectedVariantRate)}
                />
                <p className="pt-3 text-xs text-slate-500">
                  Formula uses a two-sided z-test approximation for two independent proportions.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

type InputFieldProps = {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
};

function InputField({ id, label, value, error, onChange }: InputFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
          error ? "border-rose-500 bg-rose-50" : "border-slate-300 bg-white focus:border-slate-500"
        }`}
        inputMode="decimal"
      />
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

type ResultCardProps = {
  label: string;
  value: string;
};

function ResultCard({ label, value }: ResultCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
