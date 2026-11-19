<script lang="ts">
  /**
   * The one information drawer for every object (replaces the floating card + big panel):
   * what it is, identity, position, physical data, visibility, imaging, survey images, notes,
   * links and actions. Every value names its source; unknowns say "n/a". SIMBAD (via Sesame)
   * and Wikipedia are fetched when the object is opened and cached on the device.
   */
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import type { ObjectInfo } from '../lib/engine/stel';
  import type { TwilightTimes } from '../lib/conditions';
  import {
    bodyFor,
    colourClass,
    distanceFromParallax,
    targetVisibility,
  } from '../lib/astro/target';
  import { profileStats, type Profile } from '../lib/profiles';
  import { lookupObject, isFavorite, toggleFavorite, type ResultEntry } from '../lib/search/client';
  import { KIND_LABEL } from '../lib/search/index';
  import {
    loadSimbad,
    loadWikipedia,
    otypeWords,
    type SimbadDetails,
    type WikiSummary,
  } from '../lib/info/details';
  import { scoreKind, strategy, surfaceBrightness } from '../lib/plan/rank';
  import {
    bodyNow,
    jupiterMoons,
    moonInfo,
    onTerminator,
    saturnRingTilt,
  } from '../lib/plan/solarsystem';
  import { objectCurve, bodyCurve } from '../lib/plan/curves';
  import { ribbonSpan } from '../lib/ribbon';
  import { savePlan, raHms, decDms, type PlanItem } from '../lib/plan/plan';
  import { ang2pixNest, toGalactic } from '../lib/sky/healpix';
  import { surveyById } from '../lib/sky/surveys';
  import { fmtTime } from '../lib/time/format';
  import AltChart from './AltChart.svelte';

  interface Props {
    info: ObjectInfo;
    place: Place;
    time: Date;
    tw: TwilightTimes;
    tz: string | undefined;
    profiles: Profile[];
    expert: boolean;
    horizon: ArrayLike<number> | null;
    plan: PlanItem[];
    onclose?: () => void;
    ongoto: () => void;
    onframe: () => void;
  }
  let {
    info,
    place,
    time,
    tw,
    tz,
    profiles,
    expert,
    horizon,
    plan = $bindable(),
    onclose,
    ongoto,
    onframe,
  }: Props = $props();

  const minute = $derived(Math.floor(time.getTime() / 60_000));
  const body = $derived(bodyFor([info.name, ...info.otherNames, ...info.ids]));
  const vis = $derived.by(() => {
    void minute;
    return targetVisibility(
      { name: info.name, ra2000: info.ra2000, dec2000: info.dec2000, body },
      place,
      time,
      { start: tw.astroEnd ?? tw.nauticalEnd, end: tw.astroStart ?? tw.nauticalStart },
    );
  });

  // ---- catalog + online details (per object) ---------------------------------------------
  let cat = $state<ResultEntry | null>(null);
  let simbad = $state<SimbadDetails | null>(null);
  let wiki = $state<WikiSummary | null>(null);
  let online = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
  $effect(() => {
    const keys = [info.name, ...info.otherNames, ...info.ids];
    const isBody = !!body;
    const ctrl = new AbortController();
    cat = null;
    simbad = null;
    wiki = null;
    online = 'loading';
    void (async () => {
      try {
        const c = isBody ? null : await lookupObject(keys);
        if (ctrl.signal.aborted) return;
        cat = c;
        const primary = c?.info?.designations[0] ?? info.ids[0] ?? info.name;
        const common =
          c?.info?.common[0] ?? (/^[A-Z][a-z]+( [A-Z][a-z]+)*$/.test(info.name) ? info.name : null);
        const wikiTitle = isBody
          ? body === 'Moon'
            ? 'Moon'
            : body === 'Sun'
              ? 'Sun'
              : `${body} (planet)`
          : (common ?? primary.replace(/^M (\d+)$/, 'Messier $1'));
        const [s, w] = await Promise.all([
          isBody ? Promise.resolve(null) : loadSimbad(primary, ctrl.signal).catch(() => null),
          loadWikipedia(wikiTitle, ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        simbad = s;
        wiki = w ?? (isBody && body ? await loadWikipedia(body, ctrl.signal) : null);
        online = 'done';
      } catch {
        if (!ctrl.signal.aborted) online = 'error';
      }
    })();
    return () => ctrl.abort();
  });

  // ---- derived facts ---------------------------------------------------------------------
  const kind = $derived(cat?.type ?? (body ? 'planet' : info.model === 'star' ? 'star' : 'other'));
  const kindLabel = $derived(
    body
      ? body === 'Sun'
        ? 'Star (our Sun)'
        : body === 'Moon'
          ? "Earth's Moon"
          : 'Planet'
      : (KIND_LABEL[kind] ?? info.type ?? 'Object'),
  );
  const con = $derived(Astronomy.Constellation(info.ra2000 / 15, info.dec2000));
  const gal = $derived(toGalactic(info.ra2000, info.dec2000));
  const ecl = $derived.by(() => {
    const e = (23.4392911 * Math.PI) / 180;
    const a = (info.ra2000 * Math.PI) / 180;
    const d = (info.dec2000 * Math.PI) / 180;
    const lam = Math.atan2(Math.sin(a) * Math.cos(e) + Math.tan(d) * Math.sin(e), Math.cos(a));
    const bet = Math.asin(Math.sin(d) * Math.cos(e) - Math.cos(d) * Math.sin(e) * Math.sin(a));
    return { lon: ((lam * 180) / Math.PI + 360) % 360, lat: (bet * 180) / Math.PI };
  });
  const hourAngle = $derived.by(() => {
    void minute;
    const lst = Astronomy.SiderealTime(time) * 15 + place.lon;
    return ((((lst - info.ra) % 360) + 540) % 360) - 180;
  });
  const mag = $derived(info.vmag ?? cat?.mag ?? null);
  const maj = $derived(info.sizeMajor ?? (cat?.sizeDeg != null ? cat.sizeDeg * 60 : null));
  const min = $derived(info.sizeMinor ?? cat?.info?.min ?? null);
  const sb = $derived(body || kind === 'star' ? null : surfaceBrightness(mag, maj, min));
  const dist = $derived(distanceFromParallax(info.parallaxMas ?? simbad?.plx ?? null));
  const catDistLy = $derived(cat?.info?.distKpc ? cat.info.distKpc * 3261.56 : null);
  const colour = $derived(info.model === 'star' ? colourClass(info.bv) : null);
  const planet = $derived(body ? bodyNow(body, place, time) : null);
  const moon = $derived(body === 'Moon' ? moonInfo(time) : null);
  const terminator = $derived(moon ? onTerminator(moon) : []);

  function summary(): string {
    const name = cat?.info?.common[0] ?? body ?? info.name;
    if (body === 'Sun')
      return 'Our star. Never look at it or point a telescope at it without a certified full-aperture solar filter.';
    if (body === 'Moon')
      return `Earth's natural satellite, ${moon ? `${Math.round(moon.illum * 100)} % lit tonight (${moon.phaseName.toLowerCase()})` : ''}.`;
    if (body)
      return `${name}, a planet of our Solar System${planet ? `, now ${planet.distAu.toFixed(2)} AU away` : ''}.`;
    const where = `in ${con.name}`;
    const far = dist
      ? ` about ${fmtLy(dist.ly)} away`
      : catDistLy
        ? ` about ${fmtLy(catDistLy)} away`
        : '';
    // Lower-case the type except acronyms ("HII region" stays "HII").
    const what = (otypeWords(simbad?.otype ?? null) ?? kindLabel).replace(/\b[A-Z][a-z]+\b/g, (w) =>
      w.toLowerCase(),
    );
    // "An" before a vowel sound, including spelled-out acronyms (an HII region).
    return `${name === info.name ? 'A' : `${name} is a`} ${what} ${where}${far}.`.replace(
      /(^|\bis )a ([aeiou]|H[IV])/i,
      (_m, pre: string, c: string) => `${pre}${pre ? 'an' : 'An'} ${c}`,
    );
  }
  const fmtLy = (ly: number) =>
    ly < 1000
      ? `${ly.toFixed(ly < 10 ? 1 : 0)} light years`
      : ly < 1e6
        ? `${Math.round(ly / 100) / 10} thousand light years`
        : ly < 1e9
          ? `${Math.round(ly / 1e5) / 10} million light years`
          : `${Math.round(ly / 1e8) / 10} billion light years`;
  const t = (d: Date | number | null | undefined) => (d == null ? 'n/a' : fmtTime(d, tz));
  const deg = (x: number, digits = 1) => `${x.toFixed(digits)}°`;
  // One unit for both axes, picked from the major axis, so "85′ × 60′" never reads "1.42° × 60′".
  const unitFor = (am: number) => (am >= 120 ? 'deg' : am >= 1 ? 'arcmin' : 'arcsec');
  const size = (am: number, unit = unitFor(am)) =>
    unit === 'deg'
      ? `${(am / 60).toFixed(2)}°`
      : unit === 'arcmin'
        ? `${am.toFixed(1)}′`
        : `${(am * 60).toFixed(1)}″`;
  const compass = (az: number) =>
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

  // ---- imaging --------------------------------------------------------------------------
  const fits = $derived(
    profiles.map((p) => {
      const st = profileStats(p);
      const fill = maj != null ? maj / 60 / Math.min(st.fovW, st.fovH) : null;
      return { p, st, fill };
    }),
  );
  const strat = $derived.by(() => {
    if (body || kind === 'star') return null;
    const p = profiles[0];
    const o = { sk: scoreKind(kind) } as Parameters<typeof strategy>[0];
    return strategy(o, moonInfo(time).illum, 0.5, 18, p?.filters ?? []);
  });

  // ---- survey gallery -------------------------------------------------------------------
  const GALLERY = ['dss', '2mass', 'allwise', 'panstarrs', 'halpha', 'galex'];
  let gal_i = $state(0);
  function pixAt(order: number, galactic: boolean): number {
    const { l, b } = galactic
      ? toGalactic(info.ra2000, info.dec2000)
      : { l: info.ra2000, b: info.dec2000 };
    return ang2pixNest(order, ((90 - b) * Math.PI) / 180, (l * Math.PI) / 180);
  }
  /** One tile around the object, at the order whose tiles are ~4× the object's size. */
  const gallery = $derived.by(() => {
    const sizeDeg = Math.max(0.25, ((maj ?? 6) / 60) * 4);
    const order = Math.max(3, Math.min(9, Math.round(Math.log2(58.6 / sizeDeg))));
    return GALLERY.map((id) => surveyById(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => {
        const base = s.servers.find((u) => !u.includes('cds.unistra.fr')) ?? s.servers[0] ?? '';
        const pix = pixAt(order, s.frame === 'galactic');
        return {
          s,
          url: `${base}/Norder${order}/Dir${Math.floor(pix / 10000) * 10000}/Npix${pix}.jpg`,
        };
      });
  });

  const galCurrent = $derived(gallery[gal_i] ?? null);

  // ---- notes, plan, favorite ------------------------------------------------------------
  const NOTES = 'anp.notes.v1';
  const noteKey = $derived(cat?.info?.designations[0] ?? info.name);
  let note = $state('');
  $effect(() => {
    try {
      note =
        (JSON.parse(localStorage.getItem(NOTES) ?? '{}') as Record<string, string>)[noteKey] ?? '';
    } catch {
      note = '';
    }
  });
  function saveNote() {
    try {
      const stored = JSON.parse(localStorage.getItem(NOTES) ?? '{}') as Record<string, string>;
      const all = Object.fromEntries(Object.entries(stored).filter(([k]) => k !== noteKey));
      if (note.trim()) all[noteKey] = note.slice(0, 4000);
      localStorage.setItem(NOTES, JSON.stringify(all));
    } catch {
      /* private mode */
    }
  }
  const asEntry = $derived<ResultEntry>({
    kind: body ? 'planet' : 'dso',
    label: noteKey,
    sub: kindLabel,
    badges: [],
    ra: info.ra2000,
    dec: info.dec2000,
    sizeDeg: (maj ?? 6) / 60,
  });
  let fav = $derived(isFavorite(asEntry));
  const inPlan = $derived(plan.some((p) => p.name === noteKey));
  function togglePlan() {
    plan = inPlan
      ? plan.filter((p) => p.name !== noteKey)
      : [
          ...plan,
          {
            name: noteKey,
            common: cat?.info?.common[0] ?? '',
            type: kindLabel,
            ra: info.ra2000,
            dec: info.dec2000,
            pa: 0,
            window: null,
            transit: vis.transit?.getTime() ?? null,
          },
        ];
    savePlan(plan);
  }
  const span = $derived(ribbonSpan(tw, time.getTime()));
  const site = $derived({ lat: place.lat, lon: place.lon, elevation: place.elevation });
  const curve = $derived(
    body
      ? bodyCurve(body, site, span.start, span.end, 15)
      : objectCurve(info.ra2000, info.dec2000, site, span.start, span.end, 15),
  );
  const moonCurve = $derived(bodyCurve('Moon', site, span.start, span.end, 20));
  const designations = $derived(
    [
      ...new Set([
        ...(cat?.info?.designations ?? []),
        ...info.ids,
        ...info.otherNames,
        ...(simbad?.aliases.slice(0, expert ? 30 : 8) ?? []),
      ]),
    ].filter((n) => n && n !== info.name),
  );
  const linkName = $derived(cat?.info?.designations[0] ?? info.ids[0] ?? info.name);
</script>

<article class="info" aria-labelledby="info-title">
  <header>
    <div>
      <h3 id="info-title" class="obj-name">
        {cat?.info?.common[0]
          ? `${cat.info.designations[0] ?? info.name} · ${cat.info.common[0]}`
          : info.name}
      </h3>
      <p class="type">{kindLabel}{con ? ` in ${con.name}` : ''}</p>
    </div>
    {#if onclose}<button class="x deselect" onclick={onclose} title="Clear the selection on the sky"
        >Deselect</button
      >{/if}
  </header>

  {#if body === 'Sun'}
    <p class="solar" role="alert">
      <strong>Never look at or image the Sun</strong> without a certified full-aperture solar filter.
    </p>
  {/if}

  <section>
    <h4>What is this?</h4>
    <p>{summary()}</p>
    {#if wiki}
      <p class="wiki">
        {wiki.extract.slice(0, expert ? 600 : 280)}{wiki.extract.length > (expert ? 600 : 280)
          ? '…'
          : ''} <a href={wiki.url} target="_blank" rel="noopener">Wikipedia</a>
      </p>
    {:else if online === 'loading'}
      <p class="src">Looking up SIMBAD and Wikipedia…</p>
    {/if}
  </section>

  <div class="actions">
    <button onclick={ongoto}>Centre in the sky</button>
    {#if !body || body !== 'Sun'}<button onclick={onframe}>Frame with my camera</button>{/if}
    <button aria-pressed={inPlan} onclick={togglePlan}>{inPlan ? '✓ In plan' : '+ Plan'}</button>
    <button aria-pressed={fav} onclick={() => (fav = toggleFavorite(asEntry))}
      >{fav ? '★ Favorite' : '☆ Favorite'}</button
    >
  </div>

  {#if !body}
    <section class="gallery">
      <h4>Survey images</h4>
      <div class="gal-switch" role="tablist" aria-label="Survey">
        {#each gallery as g, i (g.s.id)}
          <button role="tab" aria-selected={gal_i === i} onclick={() => (gal_i = i)}
            >{g.s.label.replace(/ \(.+\)$/, '')}</button
          >
        {/each}
      </div>
      {#if galCurrent}
        <img
          src={galCurrent.url}
          alt={`${info.name} in ${galCurrent.s.label}`}
          loading="lazy"
          width="256"
          height="256"
          onerror={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = '0.15')}
        />
        <p class="src">
          One HiPS tile around the object (not centred), streamed from the survey's server. {galCurrent
            .s.shows}
        </p>
      {/if}
    </section>
  {/if}

  <section>
    <h4>Identity</h4>
    <dl>
      <dt>Type</dt>
      <dd>
        {kindLabel}{simbad?.otype
          ? ` · SIMBAD: ${otypeWords(simbad.otype) ?? simbad.otype}`
          : ''}{(cat?.info?.morph ?? simbad?.morph)
          ? ` · morphology ${cat?.info?.morph ?? simbad?.morph}`
          : ''}
      </dd>
      {#if cat?.badges?.length}<dt>Catalogs</dt>
        <dd>{cat.badges.join(', ')}</dd>{/if}
      <dt>Also known as</dt>
      <dd>{designations.length ? designations.slice(0, expert ? 40 : 10).join(' · ') : 'n/a'}</dd>
    </dl>
  </section>

  <section>
    <h4>Position</h4>
    <dl>
      <dt>Now</dt>
      <dd>
        {deg(vis.altNow)} high, {compass(vis.azNow)} ({deg(vis.azNow)}){vis.airmassNow
          ? `, airmass ${vis.airmassNow.toFixed(2)}`
          : ' — below the horizon'}
      </dd>
      <dt>RA / Dec J2000</dt>
      <dd>{raHms(info.ra2000)} / {decDms(info.dec2000)}</dd>
      {#if expert}
        <dt>RA / Dec of date</dt>
        <dd>{raHms(info.ra)} / {decDms(info.dec)}</dd>
        <dt>Hour angle</dt>
        <dd>
          {(hourAngle / 15).toFixed(2)} h ({hourAngle < 0
            ? 'rising, east of the meridian'
            : 'setting, west of the meridian'})
        </dd>
        <dt>Galactic</dt>
        <dd>l {deg(gal.l, 2)}, b {deg(gal.b, 2)}</dd>
        <dt>Ecliptic (J2000)</dt>
        <dd>λ {deg(ecl.lon, 2)}, β {deg(ecl.lat, 2)}</dd>
      {/if}
      <dt>Constellation</dt>
      <dd>{con.name} ({con.symbol})</dd>
    </dl>
  </section>

  <section>
    <h4>Physical</h4>
    <dl>
      <dt>Magnitude</dt>
      <dd>
        {mag != null ? `V ${mag.toFixed(2)}` : 'n/a'}{simbad?.mags.B != null
          ? ` · B ${simbad.mags.B}`
          : ''}
        <span class="src"
          >{info.vmag != null ? 'engine' : mag != null ? 'catalog' : 'not in catalog'}</span
        >
      </dd>
      {#if maj != null}<dt>Size</dt>
        <dd>
          {size(maj)}{min != null && Math.abs(min - maj) > 0.05
            ? ` × ${size(min, unitFor(maj))}`
            : ''}{cat?.info?.pa != null ? `, PA ${cat.info.pa}°` : ''}
        </dd>{/if}
      {#if sb != null}<dt>Surface brightness</dt>
        <dd>
          {sb.toFixed(1)} mag/arcsec² <span class="src">computed (mean over the ellipse)</span>
        </dd>{/if}
      <dt>Distance</dt>
      <dd>
        {dist
          ? `${fmtLy(dist.ly)} (parallax)`
          : catDistLy
            ? `${fmtLy(catDistLy)} (catalog)`
            : planet
              ? `${planet.distAu.toFixed(3)} AU`
              : 'n/a'}
      </dd>
      {#if Math.abs(cat?.info?.z ?? simbad?.z ?? 0) >= 0.001}<dt>Redshift</dt>
        <dd>z = {cat?.info?.z ?? simbad?.z}</dd>{/if}
      {#if simbad?.rv != null}<dt>Radial velocity</dt>
        <dd>{simbad.rv} km/s <span class="src">SIMBAD</span></dd>{/if}
      {#if simbad?.spType}<dt>Spectral type</dt>
        <dd>{simbad.spType}</dd>{/if}
      {#if colour}<dt>Colour</dt>
        <dd>B−V {info.bv?.toFixed(2)} · about {colour.tempK.toLocaleString()} K (estimate)</dd>{/if}
      {#if expert && simbad?.pmRa != null}<dt>Proper motion</dt>
        <dd>
          µα* {simbad.pmRa.toFixed(2)}, µδ {simbad.pmDec != null ? simbad.pmDec.toFixed(2) : 'n/a'} mas/yr
        </dd>{/if}
      {#if expert && simbad?.plx != null}<dt>Parallax</dt>
        <dd>{simbad.plx} mas</dd>{/if}
      {#if planet}
        <dt>Apparent diameter</dt>
        <dd>
          {planet.diameter >= 120
            ? `${(planet.diameter / 60).toFixed(1)}′`
            : `${planet.diameter.toFixed(1)}″`}
        </dd>
        {#if planet.phase != null}<dt>Lit</dt>
          <dd>{Math.round(planet.phase * 100)} %</dd>{/if}
        {#if planet.elongation != null}<dt>From the Sun</dt>
          <dd>{deg(planet.elongation, 0)}</dd>{/if}
      {/if}
      {#if body === 'Jupiter'}<dt>Galilean moons</dt>
        <dd>
          {jupiterMoons(time)
            .map((m) => `${m.name} ${Math.abs(m.x).toFixed(1)} R ${m.x > 0 ? 'E' : 'W'}`)
            .join(' · ')}
        </dd>{/if}
      {#if body === 'Saturn'}<dt>Ring tilt</dt>
        <dd>{deg(Math.abs(saturnRingTilt(time)))}</dd>{/if}
      {#if moon}
        <dt>Phase</dt>
        <dd>{moon.phaseName}, age {moon.ageDays.toFixed(1)} d</dd>
        <dt>Libration</dt>
        <dd>lat {deg(moon.libration.lat)}, lon {deg(moon.libration.lon)}</dd>
        <dt>Terminator</dt>
        <dd>
          {terminator.length
            ? terminator
                .slice(0, 5)
                .map((f) => f.name)
                .join(', ')
            : 'no listed feature near it'}
        </dd>
      {/if}
    </dl>
    {#if online === 'error'}<p class="src">
        SIMBAD/Wikipedia could not be reached; catalog and computed values are shown.
      </p>{/if}
  </section>

  <section>
    <h4>Visibility tonight</h4>
    <dl>
      <dt>Rise / transit / set</dt>
      <dd>
        {vis.neverRises
          ? 'never rises here'
          : vis.circumpolar
            ? `never sets; transits ${t(vis.transit)}`
            : `${t(vis.rise)} / ${t(vis.transit)} / ${t(vis.set)}`}{vis.transitAlt != null &&
        !vis.neverRises
          ? ` (highest ${deg(vis.transitAlt)})`
          : ''}
      </dd>
      <dt>In darkness</dt>
      <dd>
        {vis.bestTonight && vis.bestTonight.alt > 0
          ? `highest ${deg(vis.bestTonight.alt)} at ${t(vis.bestTonight.t)}; ${vis.darkHoursAbove30} h above 30°`
          : 'not above the horizon during darkness'}
      </dd>
      {#if vis.moonSep != null && body !== 'Moon'}<dt>From the Moon</dt>
        <dd>
          {deg(vis.moonSep)}{vis.moonSep < 30 ? ' — close: moonlight hurts contrast' : ''}
        </dd>{/if}
    </dl>
    <AltChart
      obj={curve}
      moon={moonCurve}
      {tw}
      minAlt={30}
      {horizon}
      shown={time.getTime()}
      {tz}
      label={`Altitude of ${info.name} tonight`}
    />
  </section>

  {#if body !== 'Sun'}
    <section>
      <h4>Imaging</h4>
      {#if strat}<p>{strat}</p>{/if}
      <dl>
        {#each fits as f (f.p.id)}
          <dt>{f.p.name}</dt>
          <dd>
            {f.fill == null
              ? 'size n/a'
              : f.fill > 1
                ? `${Math.round(f.fill * 100)} % of the short side: mosaic of about ${Math.ceil(f.fill)}×${Math.ceil(f.fill)}`
                : `${Math.round(f.fill * 100)} % of the short side${f.fill < 0.15 ? ' (small)' : ''}`}
            <span class="src">{f.st.pixelScale.toFixed(2)}″/px</span>
          </dd>
        {/each}
      </dl>
    </section>
  {/if}

  <section>
    <h4>Your notes</h4>
    <textarea
      bind:value={note}
      onchange={saveNote}
      rows="3"
      placeholder="Exposure, filters, what worked… (kept on this device)"></textarea>
  </section>

  <section>
    <h4>Links</h4>
    <p class="links">
      <a
        href={`https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=${encodeURIComponent(linkName)}`}
        target="_blank"
        rel="noopener">SIMBAD</a
      >
      <a
        href={`https://ned.ipac.caltech.edu/byname?objname=${encodeURIComponent(linkName)}`}
        target="_blank"
        rel="noopener">NED</a
      >
      <a
        href={wiki?.url ||
          `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(linkName)}`}
        target="_blank"
        rel="noopener">Wikipedia</a
      >
      <a
        href={`https://sky.esa.int/esasky/?target=${info.ra2000.toFixed(5)}%20${info.dec2000.toFixed(5)}&fov=${Math.max(0.2, ((maj ?? 10) / 60) * 3).toFixed(2)}&hips=DSS2+color&cooframe=J2000&sci=true`}
        target="_blank"
        rel="noopener">ESASky</a
      >
    </p>
    <p class="src">
      Sources: Stellarium Web Engine, Stellarium DSO catalog, SIMBAD via Sesame (CfA mirror),
      Wikipedia, Astronomy Engine.
    </p>
  </section>
</article>

<style>
  .info {
    display: grid;
    gap: var(--s3);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: var(--s2);
    align-items: start;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-21);
  }
  h4 {
    margin: 0 0 var(--s1);
    font-size: var(--fs-14);
    font-weight: 700;
  }
  .type {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: var(--fs-14);
  }
  .x {
    min-height: 32px;
    min-width: 32px;
  }
  .deselect {
    padding: 0 var(--s2);
    font-size: var(--fs-12);
    white-space: nowrap;
  }
  p {
    margin: 0;
    font-size: var(--fs-14);
  }
  .wiki {
    margin-top: var(--s1);
    color: var(--text-2);
  }
  .solar {
    padding: var(--s2) var(--s3);
    border: 1px solid var(--nogo);
    border-radius: var(--r-input);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .actions button {
    font-size: var(--fs-14);
  }
  .actions button[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(90px, auto) minmax(0, 1fr);
    gap: 4px var(--s3);
    font-size: var(--fs-14);
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .src {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .gal-switch {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: var(--s2);
  }
  .gal-switch button {
    font-size: var(--fs-12);
    padding: 2px 8px;
    min-height: 28px;
  }
  .gal-switch button[aria-selected='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  .gallery img {
    width: 100%;
    max-width: 256px;
    height: auto;
    border-radius: var(--r-input);
    background: var(--ink-0);
    filter: var(--media-filter);
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: var(--fs-14);
    color: var(--text);
    background: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: var(--s2);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
  }
  .links a {
    color: var(--brass);
  }
</style>
