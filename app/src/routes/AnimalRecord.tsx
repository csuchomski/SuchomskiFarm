import { Link, useParams } from "react-router-dom";
import {
  Button,
  Callout,
  CurveChart,
  EarTag,
  GridRow,
  Pill,
  ProgressBar,
  Sparkline,
  StatTile,
  WithdrawalBanner,
} from "../components/ui";
import {
  findAnimal,
  hazelCosts,
  hazelCurve,
  hazelHealthTimeline,
  hazelMilkDestinations,
  hazelMilkDestinationsSummary,
  hazelProfile,
  sparkTones,
} from "../lib/mockData";
import "./animal-record.css";

function parseDaysInMilk(label: string): number | null {
  const m = /d(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

export default function AnimalRecord() {
  const { tag = "" } = useParams();
  const animal = findAnimal(tag);

  if (!animal) {
    return (
      <div style={{ padding: 48 }}>
        <p>No animal on tag {tag}.</p>
        <Link to="/animals">← back to Animals</Link>
      </div>
    );
  }

  const isHazel = animal.tag === "1103";
  const isWithdrawal = animal.status === "withdrawal";
  const daysInMilk = isHazel ? hazelProfile.daysInMilk : parseDaysInMilk(animal.lactationLabel);
  const lactationNum = /L(\d+)/.exec(animal.lactationLabel)?.[1] ?? "?";
  const costPerGallon = isHazel ? hazelProfile.costPerGallon : animal.costToDate / animal.gallonsToDate;

  return (
    <div style={{ background: "var(--paper)" }}>
      <div className="record-topbar">
        <div className="serif" style={{ fontSize: 22, letterSpacing: "-.02em" }}>
          Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
        </div>
        <div className="eyebrow">Herd · Animals · {animal.name}</div>
      </div>

      {isWithdrawal && (
        <WithdrawalBanner
          variant="full"
          eyebrow="Withdrawal in effect"
          title="Milk from this animal cannot be sold until 9 August"
          facts={[
            "Excede · administered 30 July",
            "5 days remaining",
            "Excluded from every store batch automatically",
            "3.9 gal fed to pigs so far",
          ]}
        />
      )}

      <div className="record-head">
        <div className="record-head__top">
          <div className="record-photo">
            <span className="eyebrow" style={{ fontSize: 10 }}>
              Photo
            </span>
          </div>
          <div className="record-head__id">
            <div className="serif record-head__name">{animal.name}</div>
            <div className="record-head__meta">
              <span>{animal.breed}</span>
              {isHazel && (
                <>
                  <span>·</span>
                  <span>born {hazelProfile.bornDate}</span>
                  <span>·</span>
                  <span>{hazelProfile.ageLabel}</span>
                </>
              )}
              <Pill variant="outline-green">Dairy cow</Pill>
              {isWithdrawal && <Pill variant="withdrawal">Withdrawal</Pill>}
            </div>
          </div>
          <EarTag tag={animal.tag} accent={animal.tagAccent} size="lg" />
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button>Log treatment</Button>
            <Button variant="filled">Log milking</Button>
          </div>
        </div>

        <div className="record-head__stats">
          <StatTile size="md" value={animal.gallonsToDate.toLocaleString()} label={`Gal · L${lactationNum}`} />
          <StatTile size="md" value={(isHazel ? hazelProfile.peakGalDay : animal.peakGallons) ?? "—"} label="Peak gal / day" />
          <StatTile size="md" value={daysInMilk ?? "—"} label="Days in milk" />
          <StatTile size="md" tone="red" value={`$${animal.costToDate}`} label={`Cost · L${lactationNum}`} />
          <StatTile
            size="md"
            value={`${animal.netToDate < 0 ? "−" : "+"}$${Math.abs(animal.netToDate)}`}
            label={`Net · L${lactationNum}`}
          />
          <StatTile size="md" value={`$${costPerGallon.toFixed(2)}`} label="Cost / gallon" />
        </div>

        <div className="record-tabs">
          <span className="eyebrow record-tab">Record</span>
          <span className="eyebrow record-tab record-tab--active">Milk &amp; money</span>
          <span className="eyebrow record-tab">
            Health {isHazel && <span className="mono" style={{ marginLeft: 4, letterSpacing: 0 }}>{hazelProfile.healthCount}</span>}
          </span>
          <span className="eyebrow record-tab">
            Lactations{" "}
            {isHazel && <span className="mono" style={{ marginLeft: 4, letterSpacing: 0 }}>{hazelProfile.lactationCount}</span>}
          </span>
          <span className="eyebrow record-tab">Pedigree</span>
          <span className="eyebrow record-tab">
            Calves {isHazel && <span className="mono" style={{ marginLeft: 4, letterSpacing: 0 }}>{hazelProfile.calvesCount}</span>}
          </span>
        </div>
      </div>

      <div className="record-body">
        <div>
          {/* lactation curve */}
          <div style={{ paddingBottom: 24, borderBottom: "1px solid var(--hairline)" }}>
            <div className="section__head" style={{ marginBottom: 16 }}>
              <div className="serif" style={{ fontSize: 21 }}>
                Lactation curve
              </div>
              {isHazel ? (
                <div className="mono curve-legend">
                  <span style={{ color: "var(--ink-soft)" }}>
                    <span className="curve-legend__swatch" style={{ background: "var(--herd-green)" }} />
                    L2 current
                  </span>
                  <span style={{ color: "var(--ink-muted)" }}>
                    <span className="curve-legend__swatch" style={{ background: "var(--paper-tint)" }} />
                    L1 same day
                  </span>
                  <span style={{ color: "var(--ochre)" }}>
                    <span
                      className="curve-legend__swatch"
                      style={{ background: "var(--hazard-yellow)", border: "1px solid var(--ink)" }}
                    />
                    Discarded
                  </span>
                </div>
              ) : (
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                  this lactation
                </span>
              )}
            </div>

            {isHazel ? (
              <>
                <CurveChart points={hazelCurve} />
                <div className="curve-axis mono">
                  <span>day 10</span>
                  <span>peak · day 52 · 2.9 gal</span>
                  <span>day 305 projected</span>
                </div>
              </>
            ) : (
              <>
                <Sparkline bars={animal.sparkline.map((h, i) => ({ h, tone: sparkTones[animal.tag][i] }))} height={140} />
                <div className="curve-axis mono">
                  <span>freshened {animal.freshened ?? "—"}</span>
                  <span>{animal.firstLactation ? "first lactation" : `peak ${animal.peakGallons} gal`}</span>
                </div>
              </>
            )}
          </div>

          {/* where the milk went */}
          <div style={{ paddingTop: 24 }}>
            <div className="section__head" style={{ marginBottom: 12 }}>
              <div className="serif" style={{ fontSize: 21 }}>
                Where {isHazel ? "her" : "the"} milk went
              </div>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                last 7 days
              </span>
            </div>

            {isHazel ? (
              <>
                <GridRow cols="88px 1fr 74px 1fr 88px" as="header">
                  <span>Date</span>
                  <span>Batch</span>
                  <span className="text-right">Gal</span>
                  <span>Outcome</span>
                  <span className="text-right">Value</span>
                </GridRow>
                {hazelMilkDestinations.map((d) => (
                  <GridRow
                    key={d.date}
                    cols="88px 1fr 74px 1fr 88px"
                    as="body"
                    className="mono"
                    style={d.excluded ? { background: "var(--hazard-yellow-wash)" } : undefined}
                  >
                    <span>{d.date}</span>
                    <span style={{ color: "var(--ink-muted)" }}>{d.batch}</span>
                    <span className="text-right">{d.gallons}</span>
                    <span
                      style={{
                        color:
                          d.outcomeColor === "ochre" ? "var(--ochre)" : d.outcomeColor === "herd" ? "var(--herd-green)" : undefined,
                      }}
                    >
                      {d.outcome}
                    </span>
                    <span className="text-right">{d.value}</span>
                  </GridRow>
                ))}
                <GridRow
                  cols="88px 1fr 74px 1fr 88px"
                  as="body"
                  className="mono"
                  style={{ background: "var(--page)", fontWeight: 500, padding: "12px 8px" }}
                >
                  <span>{hazelMilkDestinationsSummary.date}</span>
                  <span style={{ color: "var(--ink-muted)" }}>{hazelMilkDestinationsSummary.batch}</span>
                  <span className="text-right">{hazelMilkDestinationsSummary.gallons}</span>
                  <span style={{ color: "var(--ochre)" }}>{hazelMilkDestinationsSummary.outcome}</span>
                  <span className="text-right">{hazelMilkDestinationsSummary.value}</span>
                </GridRow>
                <Callout>
                  Her feed and vet costs keep accruing through the withdrawal while none of her milk can be sold —
                  that gap is the honest reason her net is behind the others this lactation.
                </Callout>
              </>
            ) : (
              <Callout>
                All of {animal.name}'s milk pools with the herd's daily batch — nothing is held back, so there's no
                separate per-pickup breakdown to show here.
              </Callout>
            )}
          </div>
        </div>

        {/* right column */}
        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Costs on {isHazel ? "her" : "the"} line
          </div>
          <div style={{ padding: "0 0 8px" }}>
            {(isHazel
              ? hazelCosts
              : hazelCosts.map((c) => ({ ...c, amount: Math.round((animal.costToDate * c.pct) / 100) }))
            ).map((c) => (
              <ProgressBar key={c.label} label={c.label} valueLabel={`$${c.amount}`} pct={c.pct} />
            ))}
          </div>
          <div
            className="mono"
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--hairline)",
              padding: "12px 0",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--ink-muted)" }}>
              Attributed via <span style={{ color: "var(--ink)" }}>Dairy herd</span>
            </span>
            <span style={{ fontWeight: 500 }}>${animal.costToDate}</span>
          </div>
          <div className="source-chip">
            <span className="eyebrow">Source</span>
            <span className="mono" style={{ fontSize: 13 }}>
              Books · 14 entries →
            </span>
          </div>

          <div className="serif" style={{ fontSize: 21, margin: "0 0 12px" }}>
            Health
          </div>
          {isHazel ? (
            <div className="health-grid" style={{ marginBottom: 24 }}>
              {hazelHealthTimeline.map((h) => (
                <div key={h.date} style={{ display: "contents" }}>
                  <div className="eyebrow health-grid__date">{h.date}</div>
                  <div className="health-grid__event">
                    {h.title}
                    <br />
                    <span style={{ fontSize: 13, color: h.detailColor === "ochre" ? "var(--ochre)" : "var(--ink-muted)" }}>
                      {h.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24 }}>
              No events logged this lactation.
            </p>
          )}

          <div className="serif" style={{ fontSize: 21, margin: "0 0 12px" }}>
            Pedigree
          </div>
          <div className="pedigree-grid">
            <div className="pedigree-cell">
              <div className="eyebrow" style={{ fontSize: 10 }}>
                Dam
              </div>
              <div className="serif" style={{ fontSize: 15 }}>
                {isHazel ? hazelProfile.dam.name : "Not recorded"}
              </div>
              {isHazel && (
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                  {hazelProfile.dam.tag} · {hazelProfile.dam.breed}
                </div>
              )}
            </div>
            <div className="pedigree-cell pedigree-cell--unknown">
              <div className="eyebrow" style={{ fontSize: 10 }}>
                Sire
              </div>
              <div className="serif" style={{ fontSize: 15, color: "var(--ink-muted)" }}>
                {isHazel ? hazelProfile.sire.name : "Unknown"}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                {isHazel ? hazelProfile.sire.tag : "AI · no record"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
