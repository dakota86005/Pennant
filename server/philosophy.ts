/**
 * Organizational philosophy.
 *
 * These values describe how this organization weighs competing baseball
 * objectives. They are not player evaluations and they do not make decisions
 * by themselves.
 *
 * V1 is user-controlled. The mode/source structure deliberately anticipates
 * V2, where OOTP staff can supply some or all of these values.
 */

export const PHILOSOPHY_DIMENSIONS = [
  {
    id: 'competitiveWindow',
    label: 'Competitive window',
    low: 'Build for the future',
    high: 'Maximize current wins',
    description:
      'How strongly the organization discounts future value in favor of winning now.',
  },
  {
    id: 'riskTolerance',
    label: 'Risk tolerance',
    low: 'Prefer floor and certainty',
    high: 'Accept variance for upside',
    description:
      'Tolerance for uncertain projections, volatile players, injury risk, and high-variance outcomes.',
  },
  {
    id: 'payrollFlexibility',
    label: 'Payroll flexibility',
    low: 'Comfortable with commitments',
    high: 'Protect future flexibility',
    description:
      'How strongly future guaranteed payroll is treated as an opportunity cost.',
  },
  {
    id: 'costEfficiency',
    label: 'Cost efficiency',
    low: 'Pay for talent',
    high: 'Maximize surplus value',
    description:
      'How heavily salary efficiency and surplus value affect player decisions.',
  },
  {
    id: 'teamControl',
    label: 'Team control',
    low: 'Production matters most',
    high: 'Strong control premium',
    description:
      'How much years of inexpensive or guaranteed team control increase player value.',
  },
  {
    id: 'prospectPreservation',
    label: 'Prospect preservation',
    low: 'Prospects are trade currency',
    high: 'Protect the farm',
    description:
      'How reluctant the organization is to trade meaningful prospect capital.',
  },
  {
    id: 'promotionAggressiveness',
    label: 'Promotion aggression',
    low: 'Master each level',
    high: 'Challenge prospects quickly',
    description:
      'How readily strong performance and readiness lead to a promotion.',
  },
  {
    id: 'upsidePreference',
    label: 'Upside preference',
    low: 'Prefer certainty',
    high: 'Prefer ceiling',
    description:
      'How much upside and projection are valued relative to established ability.',
  },
  {
    id: 'ageCurveSensitivity',
    label: 'Age-curve sensitivity',
    low: 'Trust veterans',
    high: 'Discount aging aggressively',
    description:
      'How strongly expected aging decline affects contracts and player valuation.',
  },
  {
    id: 'positionalScarcity',
    label: 'Positional scarcity',
    low: 'Mostly position-neutral',
    high: 'Strong scarcity premium',
    description:
      'How much scarcity at catcher, shortstop, center field, and other difficult roles affects value.',
  },
  {
    id: 'defenseEmphasis',
    label: 'Defense emphasis',
    low: 'Bat-first',
    high: 'Glove-first',
    description:
      'How strongly defensive quality influences roster construction relative to offense.',
  },
  {
    id: 'pitchingDepth',
    label: 'Pitching depth',
    low: 'Concentrate pitching talent',
    high: 'Protect pitching inventory',
    description:
      'How much the organization values redundant starting and relief depth.',
  },
  {
    id: 'rosterDepth',
    label: 'Roster depth',
    low: 'Top-end talent matters most',
    high: 'Depth matters greatly',
    description:
      'How strongly bench, bullpen, optionable depth, and injury protection are valued.',
  },
  {
    id: 'starConcentration',
    label: 'Star concentration',
    low: 'Balanced roster',
    high: 'Stars and supporting pieces',
    description:
      'Preference for concentrating resources in elite players rather than spreading value across the roster.',
  },
  {
    id: 'versatility',
    label: 'Versatility',
    low: 'Prefer specialists',
    high: 'Prefer flexible players',
    description:
      'How much multi-position ability and roster flexibility increase player value.',
  },
] as const;

export type PhilosophyDimensionId =
  (typeof PHILOSOPHY_DIMENSIONS)[number]['id'];

export type PhilosophyMode = 'manual' | 'staff' | 'hybrid';

export type PhilosophyValues = Record<PhilosophyDimensionId, number>;

export interface PhilosophyPolicies {
  agingContracts: 'avoid' | 'discourage' | 'neutral' | 'willing';
  arbitrationExtensions: 'avoid' | 'selective' | 'prefer';
  rentalAcquisitions: 'never' | 'contending' | 'normal' | 'aggressive';
  salaryDumps: 'avoid' | 'neutral' | 'willing';
}

export interface PhilosophyProfile {
  version: 1;

  /**
   * V1 uses manual. Staff and hybrid exist now so V2 can be introduced
   * without changing the persisted shape.
   */
  mode: PhilosophyMode;

  /** User-selected values. Always available as a fallback. */
  manual: PhilosophyValues;

  /**
   * In hybrid mode these dimensions stay user-controlled while the others
   * may come from staff.
   */
  overrides: PhilosophyDimensionId[];

  policies: PhilosophyPolicies;
}

export type PhilosophyValueSource =
  | 'manual'
  | 'staff'
  | 'manual-fallback';

export interface EffectivePhilosophyDimension {
  value: number;
  source: PhilosophyValueSource;
}

export interface EffectivePhilosophy {
  mode: PhilosophyMode;
  dimensions: Record<
    PhilosophyDimensionId,
    EffectivePhilosophyDimension
  >;
  policies: PhilosophyPolicies;
}

export const DEFAULT_PHILOSOPHY_VALUES: PhilosophyValues = {
  competitiveWindow: 50,
  riskTolerance: 50,
  payrollFlexibility: 50,
  costEfficiency: 50,
  teamControl: 50,
  prospectPreservation: 50,
  promotionAggressiveness: 50,
  upsidePreference: 50,
  ageCurveSensitivity: 50,
  positionalScarcity: 50,
  defenseEmphasis: 50,
  pitchingDepth: 50,
  rosterDepth: 50,
  starConcentration: 50,
  versatility: 50,
};

export const DEFAULT_PHILOSOPHY_POLICIES: PhilosophyPolicies = {
  agingContracts: 'neutral',
  arbitrationExtensions: 'selective',
  rentalAcquisitions: 'contending',
  salaryDumps: 'neutral',
};

export const DEFAULT_PHILOSOPHY_PROFILE: PhilosophyProfile = {
  version: 1,
  mode: 'manual',
  manual: { ...DEFAULT_PHILOSOPHY_VALUES },
  overrides: [],
  policies: { ...DEFAULT_PHILOSOPHY_POLICIES },
};

export const PHILOSOPHY_POLICY_OPTIONS = {
  agingContracts: [
    { value: 'avoid', label: 'Avoid' },
    { value: 'discourage', label: 'Discourage' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'willing', label: 'Willing' },
  ],
  arbitrationExtensions: [
    { value: 'avoid', label: 'Avoid' },
    { value: 'selective', label: 'Selective' },
    { value: 'prefer', label: 'Prefer' },
  ],
  rentalAcquisitions: [
    { value: 'never', label: 'Never' },
    { value: 'contending', label: 'Only while contending' },
    { value: 'normal', label: 'Normal' },
    { value: 'aggressive', label: 'Aggressive' },
  ],
  salaryDumps: [
    { value: 'avoid', label: 'Avoid' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'willing', label: 'Willing' },
  ],
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clampScore = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const dimensionIds = new Set<string>(
  PHILOSOPHY_DIMENSIONS.map((dimension) => dimension.id)
);

const policyValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T =>
  typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : fallback;

export function normalizePhilosophyProfile(
  raw: unknown
): PhilosophyProfile {
  const input = isRecord(raw) ? raw : {};
  const rawManual = isRecord(input.manual) ? input.manual : {};

  const manual = Object.fromEntries(
    PHILOSOPHY_DIMENSIONS.map((dimension) => [
      dimension.id,
      clampScore(
        rawManual[dimension.id],
        DEFAULT_PHILOSOPHY_VALUES[dimension.id]
      ),
    ])
  ) as PhilosophyValues;

  const mode: PhilosophyMode =
    input.mode === 'staff' || input.mode === 'hybrid'
      ? input.mode
      : 'manual';

  const overrides = Array.isArray(input.overrides)
    ? input.overrides.filter(
        (value): value is PhilosophyDimensionId =>
          typeof value === 'string' && dimensionIds.has(value)
      )
    : [];

  const rawPolicies = isRecord(input.policies)
    ? input.policies
    : {};

  const policies: PhilosophyPolicies = {
    agingContracts: policyValue(
      rawPolicies.agingContracts,
      ['avoid', 'discourage', 'neutral', 'willing'] as const,
      DEFAULT_PHILOSOPHY_POLICIES.agingContracts
    ),
    arbitrationExtensions: policyValue(
      rawPolicies.arbitrationExtensions,
      ['avoid', 'selective', 'prefer'] as const,
      DEFAULT_PHILOSOPHY_POLICIES.arbitrationExtensions
    ),
    rentalAcquisitions: policyValue(
      rawPolicies.rentalAcquisitions,
      ['never', 'contending', 'normal', 'aggressive'] as const,
      DEFAULT_PHILOSOPHY_POLICIES.rentalAcquisitions
    ),
    salaryDumps: policyValue(
      rawPolicies.salaryDumps,
      ['avoid', 'neutral', 'willing'] as const,
      DEFAULT_PHILOSOPHY_POLICIES.salaryDumps
    ),
  };

  return {
    version: 1,
    mode,
    manual,
    overrides: [...new Set(overrides)],
    policies,
  };
}

/**
 * Merge a partial API update into a profile while preserving untouched
 * dimensions and policies.
 */
export function mergePhilosophyProfile(
  current: PhilosophyProfile,
  patch: unknown
): PhilosophyProfile {
  if (!isRecord(patch)) return current;

  const patchManual = isRecord(patch.manual)
    ? patch.manual
    : {};

  const patchPolicies = isRecord(patch.policies)
    ? patch.policies
    : {};

  return normalizePhilosophyProfile({
    ...current,
    ...patch,
    manual: {
      ...current.manual,
      ...patchManual,
    },
    policies: {
      ...current.policies,
      ...patchPolicies,
    },
  });
}

/**
 * Turn persisted philosophy plus optional future staff-derived values into
 * the values the decision engine should actually use.
 *
 * V1 passes no staff values, so every dimension resolves to manual.
 */
export function resolvePhilosophy(
  profile: PhilosophyProfile,
  staffValues: Partial<PhilosophyValues> = {}
): EffectivePhilosophy {
  const overrides = new Set(profile.overrides);

  const dimensions = Object.fromEntries(
    PHILOSOPHY_DIMENSIONS.map((dimension) => {
      const id = dimension.id;
      const staffValue =
        typeof staffValues[id] === 'number'
          ? clampScore(staffValues[id], profile.manual[id])
          : null;

      if (profile.mode === 'manual') {
        return [
          id,
          { value: profile.manual[id], source: 'manual' as const },
        ];
      }

      if (
        profile.mode === 'hybrid' &&
        overrides.has(id)
      ) {
        return [
          id,
          { value: profile.manual[id], source: 'manual' as const },
        ];
      }

      if (staffValue !== null) {
        return [
          id,
          { value: staffValue, source: 'staff' as const },
        ];
      }

      return [
        id,
        {
          value: profile.manual[id],
          source: 'manual-fallback' as const,
        },
      ];
    })
  ) as EffectivePhilosophy['dimensions'];

  return {
    mode: profile.mode,
    dimensions,
    policies: { ...profile.policies },
  };
}
