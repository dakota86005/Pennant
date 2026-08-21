import { useEffect, useMemo, useRef, useState } from 'react';

interface PhilosophyDimension {
  id: string;
  label: string;
  low: string;
  high: string;
  description: string;
}

interface PolicyOption {
  value: string;
  label: string;
}

interface PhilosophyProfile {
  version: 1;
  mode: 'manual' | 'staff' | 'hybrid';
  manual: Record<string, number>;
  overrides: string[];
  policies: Record<string, string>;
}

interface PhilosophyResponse {
  orgId: number;
  profile: PhilosophyProfile;
  dimensions: PhilosophyDimension[];
  policyOptions: Record<string, PolicyOption[]>;
}

interface DimensionGroup {
  title: string;
  description: string;
  ids: string[];
}

const GROUPS: DimensionGroup[] = [
  {
    title: 'Organizational Direction',
    description: 'The basic posture of the baseball operation: where wins matter and how much uncertainty you will accept.',
    ids: ['competitiveWindow', 'riskTolerance'],
  },
  {
    title: 'Financial Strategy',
    description: 'How aggressively the club spends resources and how much future flexibility matters.',
    ids: ['payrollFlexibility', 'costEfficiency'],
  },
  {
    title: 'Player Valuation',
    description: 'The traits your front office places a premium on when comparing players.',
    ids: ['teamControl', 'ageCurveSensitivity', 'positionalScarcity', 'upsidePreference'],
  },
  {
    title: 'Player Development',
    description: 'How the organization treats prospect capital and moves players through the system.',
    ids: ['prospectPreservation', 'promotionAggressiveness'],
  },
  {
    title: 'Roster Construction',
    description: 'What kind of major-league roster the organization prefers to build.',
    ids: ['defenseEmphasis', 'pitchingDepth', 'rosterDepth', 'starConcentration', 'versatility'],
  },
];

const POLICY_LABELS: Record<string, { label: string; description: string }> = {
  agingContracts: {
    label: 'Contracts into aging years',
    description: 'How willing the organization is to guarantee money into likely decline years.',
  },
  arbitrationExtensions: {
    label: 'Buying out arbitration',
    description: 'How strongly the club prefers early extensions that purchase arbitration or free-agent seasons.',
  },
  rentalAcquisitions: {
    label: 'Rental acquisitions',
    description: 'How willing the club is to trade value for players with little remaining team control.',
  },
  salaryDumps: {
    label: 'Salary-dump trades',
    description: 'How willing the organization is to spend prospect or player value to remove payroll.',
  },
};

interface IdentityRule {
  id: string;
  lowTag: string;
  highTag: string;
  lowClause: string;
  highClause: string;
}

const IDENTITY_RULES: IdentityRule[] = [
  {
    id: 'competitiveWindow',
    lowTag: 'FUTURE-ORIENTED',
    highTag: 'WIN-NOW',
    lowClause: 'protects future value even when it costs present-day wins',
    highClause: 'strongly prioritizes winning in the current competitive window',
  },
  {
    id: 'riskTolerance',
    lowTag: 'RISK-AVERSE',
    highTag: 'UPSIDE-TOLERANT',
    lowClause: 'prefers certainty and higher-floor outcomes',
    highClause: 'accepts meaningful risk in pursuit of upside',
  },
  {
    id: 'payrollFlexibility',
    lowTag: 'COMMITMENT-TOLERANT',
    highTag: 'FLEXIBILITY-FIRST',
    lowClause: 'is comfortable making meaningful future payroll commitments',
    highClause: 'places a strong premium on preserving future payroll flexibility',
  },
  {
    id: 'costEfficiency',
    lowTag: 'TALENT-FIRST',
    highTag: 'VALUE-DRIVEN',
    lowClause: 'is willing to pay market price for talent',
    highClause: 'places a strong premium on surplus value and cost efficiency',
  },
  {
    id: 'teamControl',
    lowTag: 'PRODUCTION-FIRST',
    highTag: 'CONTROL-CONSCIOUS',
    lowClause: 'values present production more than years of control',
    highClause: 'places a premium on players with meaningful team control',
  },
  {
    id: 'prospectPreservation',
    lowTag: 'TRADE-AGGRESSIVE',
    highTag: 'PROSPECT-PROTECTIVE',
    lowClause: 'is comfortable treating prospects as trade currency',
    highClause: 'is reluctant to spend significant prospect capital',
  },
  {
    id: 'promotionAggressiveness',
    lowTag: 'PATIENT-DEVELOPMENT',
    highTag: 'AGGRESSIVE-DEVELOPMENT',
    lowClause: 'prefers prospects to master each level before advancing',
    highClause: 'prefers challenging ready prospects with aggressive assignments',
  },
  {
    id: 'upsidePreference',
    lowTag: 'CERTAINTY-FIRST',
    highTag: 'UPSIDE-DRIVEN',
    lowClause: 'leans toward established ability and certainty',
    highClause: 'leans toward ceiling and projection when evaluating talent',
  },
  {
    id: 'ageCurveSensitivity',
    lowTag: 'VETERAN-FRIENDLY',
    highTag: 'AGE-SENSITIVE',
    lowClause: 'is relatively willing to trust veteran performance',
    highClause: 'discounts players aggressively as aging risk increases',
  },
  {
    id: 'positionalScarcity',
    lowTag: 'POSITION-NEUTRAL',
    highTag: 'SCARCITY-AWARE',
    lowClause: 'treats player value as relatively position-neutral',
    highClause: 'places a meaningful premium on scarce defensive positions',
  },
  {
    id: 'defenseEmphasis',
    lowTag: 'BAT-FIRST',
    highTag: 'DEFENSE-FIRST',
    lowClause: 'leans toward offense when balancing bat and glove',
    highClause: 'places a strong premium on defensive value',
  },
  {
    id: 'pitchingDepth',
    lowTag: 'TOP-HEAVY-PITCHING',
    highTag: 'PITCHING-DEPTH',
    lowClause: 'prefers concentrating pitching talent at the top of the staff',
    highClause: 'places a premium on maintaining pitching inventory and redundancy',
  },
  {
    id: 'rosterDepth',
    lowTag: 'TOP-END-FOCUSED',
    highTag: 'DEPTH-ORIENTED',
    lowClause: 'concentrates value in the strongest portion of the roster',
    highClause: 'places a premium on bench, bullpen, and optionable depth',
  },
  {
    id: 'starConcentration',
    lowTag: 'BALANCED-ROSTER',
    highTag: 'STAR-CONCENTRATED',
    lowClause: 'prefers distributing resources across a balanced roster',
    highClause: 'is willing to concentrate resources in elite players',
  },
  {
    id: 'versatility',
    lowTag: 'SPECIALIST-FRIENDLY',
    highTag: 'VERSATILITY-VALUING',
    lowClause: 'is comfortable carrying players with narrower roles',
    highClause: 'places a premium on multi-position and roster flexibility',
  },
];


const DIMENSION_SHORT_LABELS: Record<string, string> = {
  competitiveWindow: 'competitive window',
  riskTolerance: 'risk tolerance',
  payrollFlexibility: 'payroll flexibility',
  costEfficiency: 'cost efficiency',
  teamControl: 'team control',
  prospectPreservation: 'prospect preservation',
  promotionAggressiveness: 'promotion aggression',
  upsidePreference: 'upside preference',
  ageCurveSensitivity: 'age-curve sensitivity',
  positionalScarcity: 'positional scarcity',
  defenseEmphasis: 'defensive emphasis',
  pitchingDepth: 'pitching depth',
  rosterDepth: 'roster depth',
  starConcentration: 'star concentration',
  versatility: 'versatility',
};

function high(values: Record<string, number>, id: string): number {
  return Math.max(0, ((values[id] ?? 50) - 50) / 50);
}

function low(values: Record<string, number>, id: string): number {
  return Math.max(0, (50 - (values[id] ?? 50)) / 50);
}

interface CompositeIdentity {
  tag: string;
  clause: string;
  score: (values: Record<string, number>) => number;
}

const COMPOSITE_IDENTITIES: CompositeIdentity[] = [
  {
    tag: 'SUSTAINABLE CONTENDER',
    clause: 'tries to win now while protecting the controllable core and future talent base',
    score: (v) => Math.min(
      high(v, 'competitiveWindow'),
      high(v, 'teamControl'),
      high(v, 'prospectPreservation')
    ),
  },
  {
    tag: 'ALL-IN CONTENDER',
    clause: 'is willing to spend future value aggressively to improve the current club',
    score: (v) => Math.min(
      high(v, 'competitiveWindow'),
      low(v, 'prospectPreservation'),
      high(v, 'riskTolerance')
    ),
  },
  {
    tag: 'SYSTEM BUILDER',
    clause: 'prioritizes building a controllable long-term talent base over immediate wins',
    score: (v) => Math.min(
      low(v, 'competitiveWindow'),
      high(v, 'prospectPreservation'),
      high(v, 'teamControl')
    ),
  },
  {
    tag: 'EFFICIENCY ENGINE',
    clause: 'treats payroll efficiency and future flexibility as major competitive advantages',
    score: (v) => Math.min(
      high(v, 'costEfficiency'),
      high(v, 'payrollFlexibility')
    ),
  },
  {
    tag: 'STAR-LED CONTENDER',
    clause: 'concentrates resources in elite players while prioritizing the current competitive window',
    score: (v) => Math.min(
      high(v, 'competitiveWindow'),
      high(v, 'starConcentration')
    ),
  },
  {
    tag: 'DEEP CONTENDER',
    clause: 'tries to contend through roster depth rather than relying only on a small group of stars',
    score: (v) => Math.min(
      high(v, 'competitiveWindow'),
      high(v, 'rosterDepth')
    ),
  },
  {
    tag: 'MATCHUP MACHINE',
    clause: 'values interchangeable players, depth, and the ability to create favorable matchups',
    score: (v) => Math.min(
      high(v, 'rosterDepth'),
      high(v, 'versatility')
    ),
  },
  {
    tag: 'RUN-PREVENTION CLUB',
    clause: 'places unusual organizational emphasis on defense and maintaining pitching depth',
    score: (v) => Math.min(
      high(v, 'defenseEmphasis'),
      high(v, 'pitchingDepth')
    ),
  },
  {
    tag: 'FAST-TRACK PIPELINE',
    clause: 'is willing to challenge high-upside prospects aggressively when their development supports it',
    score: (v) => Math.min(
      high(v, 'promotionAggressiveness'),
      high(v, 'upsidePreference')
    ),
  },
  {
    tag: 'PREMIUM-CORE BUILDER',
    clause: 'places extra value on controllable players at difficult-to-fill positions',
    score: (v) => Math.min(
      high(v, 'teamControl'),
      high(v, 'positionalScarcity')
    ),
  },
  {
    tag: 'SHORT-COMMITMENT MODEL',
    clause: 'is especially cautious about aging curves and long-term payroll obligations',
    score: (v) => Math.min(
      high(v, 'payrollFlexibility'),
      high(v, 'ageCurveSensitivity')
    ),
  },
  {
    tag: 'CEILING SEEKER',
    clause: 'accepts uncertainty in exchange for access to higher-upside outcomes',
    score: (v) => Math.min(
      high(v, 'riskTolerance'),
      high(v, 'upsidePreference')
    ),
  },
  {
    tag: 'FLOOR-FIRST OPERATION',
    clause: 'leans toward predictable outcomes and established ability instead of projection',
    score: (v) => Math.min(
      low(v, 'riskTolerance'),
      low(v, 'upsidePreference')
    ),
  },
  {
    tag: 'DEPTH OVER STARS',
    clause: 'prefers spreading roster value across a deep roster rather than concentrating it in stars',
    score: (v) => Math.min(
      high(v, 'rosterDepth'),
      low(v, 'starConcentration')
    ),
  },
];

interface TeamAnalog {
  label: string;
  description: string;
  values: Record<string, number>;
}

const COMPARABLE_TEAMS: TeamAnalog[] = [
  {
    label: '2020 Tampa Bay Rays',
    description:
      'Low-cost, highly flexible roster construction built around depth, controllable talent, matchup options, and adaptable pitching.',
    values: {
      competitiveWindow: 82,
      riskTolerance: 65,
      payrollFlexibility: 92,
      costEfficiency: 95,
      teamControl: 88,
      prospectPreservation: 82,
      pitchingDepth: 88,
      rosterDepth: 92,
      starConcentration: 20,
      versatility: 95,
    },
  },
  {
    label: '2021 San Francisco Giants',
    description:
      'A depth-first contender that leaned heavily on versatile players, platoons, role optimization, and productive veterans.',
    values: {
      competitiveWindow: 82,
      riskTolerance: 60,
      costEfficiency: 78,
      ageCurveSensitivity: 25,
      defenseEmphasis: 60,
      rosterDepth: 95,
      starConcentration: 25,
      versatility: 95,
    },
  },
  {
    label: '2016 Chicago Cubs',
    description:
      'A young, controllable contender with depth and versatility that became increasingly willing to spend future value once the window opened.',
    values: {
      competitiveWindow: 95,
      riskTolerance: 65,
      payrollFlexibility: 45,
      costEfficiency: 60,
      teamControl: 85,
      prospectPreservation: 45,
      promotionAggressiveness: 80,
      upsidePreference: 75,
      rosterDepth: 85,
      versatility: 80,
    },
  },
  {
    label: '2020 New York Yankees',
    description:
      'A star-heavy perennial contender comfortable with major payroll commitments while still drawing meaningful value from homegrown players.',
    values: {
      competitiveWindow: 97,
      payrollFlexibility: 15,
      costEfficiency: 30,
      teamControl: 62,
      prospectPreservation: 50,
      rosterDepth: 70,
      starConcentration: 92,
    },
  },
  {
    label: '2015 Kansas City Royals',
    description:
      'A win-now club built around run prevention, bullpen strength, roster depth, athleticism, and willingness to spend prospect capital.',
    values: {
      competitiveWindow: 95,
      riskTolerance: 70,
      costEfficiency: 72,
      prospectPreservation: 30,
      defenseEmphasis: 92,
      pitchingDepth: 92,
      rosterDepth: 78,
      starConcentration: 35,
      versatility: 62,
    },
  },
  {
    label: '2023 Los Angeles Dodgers',
    description:
      'A sustained contender blending stars with organizational depth, internal development, flexible players, and a steady prospect pipeline.',
    values: {
      competitiveWindow: 95,
      payrollFlexibility: 40,
      costEfficiency: 62,
      teamControl: 72,
      prospectPreservation: 68,
      promotionAggressiveness: 72,
      upsidePreference: 68,
      rosterDepth: 90,
      starConcentration: 70,
      versatility: 82,
    },
  },
  {
    label: '2002 Oakland Athletics',
    description:
      'An extreme value-oriented contender built around cost efficiency, controllable talent, disciplined resource allocation, and finding undervalued production.',
    values: {
      competitiveWindow: 82,
      payrollFlexibility: 95,
      costEfficiency: 100,
      teamControl: 92,
      prospectPreservation: 78,
      upsidePreference: 62,
      starConcentration: 30,
    },
  },
  {
    label: '1995 Atlanta Braves',
    description:
      'A sustained contender centered on elite pitching, organizational continuity, a strong core, and enough depth to support top-end talent.',
    values: {
      competitiveWindow: 92,
      teamControl: 70,
      prospectPreservation: 70,
      pitchingDepth: 100,
      rosterDepth: 78,
      starConcentration: 62,
    },
  },
];

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) {
    return 'maintains a broadly balanced approach without a strongly expressed organizational bias';
  }
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

function buildIdentity(values: Record<string, number>) {
  const individual = IDENTITY_RULES
    .map((rule) => {
      const value = values[rule.id] ?? 50;
      return {
        ...rule,
        value,
        distance: Math.abs(value - 50),
        high: value > 50,
      };
    })
    .sort((a, b) => b.distance - a.distance);

  const composites = COMPOSITE_IDENTITIES
    .map((identity) => ({
      ...identity,
      strength: identity.score(values),
    }))
    .filter((identity) => identity.strength >= 0.28)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 2);

  const expressed = individual.filter((item) => item.distance >= 10);

  const tags = [
    ...composites.map((item) => item.tag),
    ...expressed.map((item) => item.high ? item.highTag : item.lowTag),
  ]
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 6);

  const strongestClauses = expressed
    .slice(0, 5)
    .map((item) => item.high ? item.highClause : item.lowClause);

  const compositeClause = composites[0]?.clause;
  const clauses = compositeClause
    ? [compositeClause, ...strongestClauses.slice(0, 3)]
    : strongestClauses;

  const neutralCount = individual.filter((item) => item.distance < 10).length;

  let nuance: string;
  if (neutralCount >= 9) {
    nuance =
      'Most other dimensions remain near neutral, so this is a focused philosophy rather than a strongly prescriptive one.';
  } else if (neutralCount >= 5) {
    nuance =
      'Several secondary dimensions remain close to neutral, leaving the front office flexibility outside its strongest priorities.';
  } else {
    nuance =
      'This is a strongly defined organizational philosophy, with relatively few areas left near neutral.';
  }

  return {
    headline:
      composites[0]?.tag ??
      (expressed[0]
        ? (expressed[0].high ? expressed[0].highTag : expressed[0].lowTag)
        : 'BALANCED OPERATION'),
    tags: tags.length > 0 ? tags : ['BALANCED'],
    summary: `This organization ${joinClauses(clauses)}.`,
    nuance,
  };
}

function positionLabel(dimension: PhilosophyDimension, value: number): string {
  if (value <= 15) return `Strongly — ${dimension.low}`;
  if (value <= 34) return dimension.low;
  if (value <= 44) return `Leans — ${dimension.low}`;
  if (value <= 55) return 'Balanced';
  if (value <= 65) return `Leans — ${dimension.high}`;
  if (value <= 84) return dimension.high;
  return `Strongly — ${dimension.high}`;
}

function comparableTeams(values: Record<string, number>) {
  return COMPARABLE_TEAMS
    .map((team) => {
      const entries = Object.entries(team.values);

      const rmsDistance = Math.sqrt(
        entries.reduce((sum, [id, target]) => {
          const difference = (values[id] ?? 50) - target;
          return sum + difference * difference;
        }, 0) / entries.length
      );

      const similarity = Math.max(0, 100 - rmsDistance);

      const sharedTraits = entries
        .filter(([id, target]) => {
          const current = values[id] ?? 50;
          const targetDirection = Math.sign(target - 50);
          const currentDirection = Math.sign(current - 50);

          return (
            Math.abs(target - 50) >= 15 &&
            targetDirection === currentDirection &&
            Math.abs(current - target) <= 25
          );
        })
        .sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))
        .slice(0, 3)
        .map(([id]) => DIMENSION_SHORT_LABELS[id] ?? id);

      let match = 'Loose overlap';
      if (similarity >= 82) match = 'Very close';
      else if (similarity >= 72) match = 'Close';
      else if (similarity >= 62) match = 'Some overlap';

      return {
        ...team,
        similarity,
        match,
        sharedTraits,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

export function Philosophy({
  orgId,
  orgLabel,
}: {
  orgId: number;
  orgLabel: string;
}) {
  const [data, setData] = useState<PhilosophyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    setData(null);
    setError(null);
    setSaveState('idle');

    let cancelled = false;

    void fetch(`/api/settings/philosophy/${orgId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load organizational philosophy (${response.status}).`);
        }
        return response.json() as Promise<PhilosophyResponse>;
      })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [orgId]);

  const identity = useMemo(
    () => buildIdentity(data?.profile.manual ?? {}),
    [data?.profile.manual]
  );

  const comparisons = useMemo(
    () => comparableTeams(data?.profile.manual ?? {}),
    [data?.profile.manual]
  );

  const scheduleSave = (profile: PhilosophyProfile) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }

    setSaveState('saving');

    saveTimer.current = window.setTimeout(() => {
      void fetch(`/api/settings/philosophy/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: profile.mode,
          manual: profile.manual,
          overrides: profile.overrides,
          policies: profile.policies,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to save philosophy (${response.status}).`);
          }
          return response.json() as Promise<PhilosophyResponse>;
        })
        .then((response) => {
          setData(response);
          setSaveState('saved');
        })
        .catch((err: Error) => {
          setSaveState('error');
          setError(err.message);
        });
    }, 350);
  };

  const changeDimension = (id: string, value: number) => {
    setData((current) => {
      if (!current) return current;

      const nextProfile: PhilosophyProfile = {
        ...current.profile,
        manual: {
          ...current.profile.manual,
          [id]: value,
        },
      };

      scheduleSave(nextProfile);

      return {
        ...current,
        profile: nextProfile,
      };
    });
  };

  const changePolicy = (id: string, value: string) => {
    setData((current) => {
      if (!current) return current;

      const nextProfile: PhilosophyProfile = {
        ...current.profile,
        policies: {
          ...current.profile.policies,
          [id]: value,
        },
      };

      scheduleSave(nextProfile);

      return {
        ...current,
        profile: nextProfile,
      };
    });
  };

  const resetToNeutral = async () => {
    const ok = window.confirm(
      `Reset ${orgLabel}'s organizational philosophy to the neutral defaults?`
    );
    if (!ok) return;

    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    setSaveState('saving');
    setError(null);

    try {
      const response = await fetch(`/api/settings/philosophy/${orgId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Unable to reset philosophy (${response.status}).`);
      }

      const next = await response.json() as PhilosophyResponse;
      setData(next);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setError((err as Error).message);
    }
  };

  if (error && !data) {
    return (
      <section className="philosophy-page">
        <div className="page-title">Front Office / Organizational Philosophy</div>
        <div className="banner error">{error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="philosophy-page">
        <div className="page-title">Front Office / Organizational Philosophy</div>
        <p className="muted">Loading organizational philosophy…</p>
      </section>
    );
  }

  const dimensionMap = new Map(data.dimensions.map((dimension) => [dimension.id, dimension]));

  return (
    <section className="philosophy-page">
      <div className="page-title">Front Office / Organizational Philosophy</div>

      <div className="philosophy-hero">
        <div>
          <div className="philosophy-org">{orgLabel}</div>
          <h1>Organizational Philosophy</h1>
          <p className="philosophy-intro">
            Define how this baseball operation weighs competing priorities.
            These preferences will shape recommendations; they do not make decisions for you.
          </p>
        </div>

        <div className={`philosophy-save-state ${saveState}`}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && 'Save failed'}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="philosophy-identity">
        <div className="philosophy-eyebrow">Organizational Identity</div>

        <div className="philosophy-identity-headline">{identity.headline}</div>

        <div className="philosophy-tags">
          {identity.tags.map((tag) => (
            <span key={tag} className="philosophy-tag">{tag}</span>
          ))}
        </div>

        <p>{identity.summary}</p>
        <p className="philosophy-identity-nuance">{identity.nuance}</p>
      </div>

      <div className="philosophy-source-card">
        <div>
          <div className="philosophy-eyebrow">Decision Source</div>
          <strong>Manual — V1</strong>
          <p>
            You define the club's philosophy directly. Staff-driven and hybrid
            philosophies are reserved for the next version, where the people you
            hire can influence how the organization thinks.
          </p>
        </div>
        <span className="philosophy-source-badge">MANUAL</span>
      </div>

      <section className="philosophy-section philosophy-comparisons">
        <div className="philosophy-section-heading">
          <h2>Comparable Baseball Operations</h2>
          <p>
            Clubs from baseball history whose roster-building tendencies most closely
            resemble the philosophy you have defined.
          </p>
        </div>

        <div className="philosophy-comparison-grid">
          {comparisons.map((team, index) => (
            <article key={team.label} className="philosophy-comparison">
              <div className="philosophy-comparison-top">
                <span className="philosophy-comparison-rank">#{index + 1}</span>
                <span className="philosophy-comparison-match">{team.match}</span>
              </div>

              <h3>{team.label}</h3>
              <p>{team.description}</p>

              {team.sharedTraits.length > 0 && (
                <div className="philosophy-comparison-traits">
                  <strong>Shared tendencies</strong>
                  <span>{team.sharedTraits.join(' · ')}</span>
                </div>
              )}
            </article>
          ))}
        </div>

        <p className="philosophy-comparison-note">
          These are illustrative style analogs, not claims that historical clubs held
          literal 0–100 ratings. Comparisons currently favor the modern free-agency era,
          where contract, control, payroll, and farm-system strategies are meaningfully comparable.
        </p>
      </section>

      {GROUPS.map((group) => (
        <section key={group.title} className="philosophy-section">
          <div className="philosophy-section-heading">
            <h2>{group.title}</h2>
            <p>{group.description}</p>
          </div>

          <div className="philosophy-dimensions">
            {group.ids.map((id) => {
              const dimension = dimensionMap.get(id);
              if (!dimension) return null;

              const value = data.profile.manual[id] ?? 50;

              return (
                <div key={id} className="philosophy-dimension">
                  <div className="philosophy-dimension-top">
                    <div>
                      <strong>{dimension.label}</strong>
                      <p>{dimension.description}</p>
                    </div>

                    <div className="philosophy-score">
                      <span>{value}</span>
                      <small>{positionLabel(dimension, value)}</small>
                    </div>
                  </div>

                  <input
                    className="philosophy-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={value}
                    aria-label={dimension.label}
                    onChange={(event) => changeDimension(id, Number(event.target.value))}
                  />

                  <div className="philosophy-endpoints">
                    <span>{dimension.low}</span>
                    <span>Balanced</span>
                    <span>{dimension.high}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="philosophy-section">
        <div className="philosophy-section-heading">
          <h2>Front Office Policies</h2>
          <p>
            Some organizational choices are better expressed as explicit policies
            than as numerical preferences.
          </p>
        </div>

        <div className="philosophy-policies">
          {Object.entries(data.policyOptions).map(([id, options]) => {
            const copy = POLICY_LABELS[id];

            return (
              <label key={id} className="philosophy-policy">
                <span>
                  <strong>{copy?.label ?? id}</strong>
                  {copy?.description && <small>{copy.description}</small>}
                </span>

                <select
                  value={data.profile.policies[id] ?? ''}
                  onChange={(event) => changePolicy(id, event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>

      <div className="philosophy-footer">
        <div>
          <strong>Neutral isn't necessarily correct.</strong>
          <p>
            A value of 50 means this club has no strong preference on that tradeoff.
            Move a setting because it reflects how you want this organization to operate.
          </p>
        </div>

        <button onClick={() => void resetToNeutral()}>
          Reset to neutral
        </button>
      </div>
    </section>
  );
}
