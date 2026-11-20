"use client";

import React, { useEffect, useState } from "react";
import { Briefcase, Plus, Trash2, Users, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  createJobRequisition,
  fetchConceptCatalog,
  fetchMyRequisitions,
} from "../api.js";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Input } from "../components/ui/input.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";

export default function EmployerDashboard({ onSelectRequisition }) {
  const [catalog, setCatalog] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState([
    { name: "Mark-to-Market (MTM) Margin", min_score: 75 },
    { name: "Stop-Loss & Overnight Gap Risk", min_score: 75 },
  ]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [catRes, reqRes] = await Promise.all([
        fetchConceptCatalog(),
        fetchMyRequisitions(),
      ]);
      const concepts = catRes.concepts || [];
      setCatalog(concepts);
      setRequisitions(reqRes.requisitions || []);
    } catch (err) {
      setError(err.message || "Could not load Employer Dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function addConceptRow() {
    const used = new Set(rows.map((r) => r.name));
    const nextConcept = catalog.find((c) => !used.has(c)) || catalog[0] || "";
    setRows((prev) => [...prev, { name: nextConcept, min_score: 75 }]);
  }

  function removeConceptRow(idx) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    if (title.trim().length < 3) {
      setError("Enter a role title (e.g., Derivatives Risk Analyst — NISM VIII).");
      return;
    }
    if (rows.length === 0) {
      setError("Add at least one required NISM concept and minimum score.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createJobRequisition({
        title: title.trim(),
        required_concepts: rows,
      });
      toast.success("Requisition created — finding ranked matches");
      setTitle("");
      setRequisitions((prev) => [res.requisition, ...prev]);
      onSelectRequisition(res.requisition);
    } catch (err) {
      setError(err.message || "Could not create job requisition.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-16 flex justify-center">
          <Spinner size="lg" label="Loading Employer Dashboard..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Requisition Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="default">
              <Briefcase className="h-3.5 w-3.5" /> Employer Dashboard
            </Badge>
            <Badge variant="success">Opt-In Verified Talent Pool</Badge>
          </div>
          <CardTitle className="pt-1">Create a Skill-Verified Requisition</CardTitle>
          <CardDescription>
            Define the exact financial concepts and minimum reasoning scores required. Samajh ranks
            opt-in traders who meet every threshold — highest overall score first.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="req-title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Role Title
              </label>
              <Input
                id="req-title"
                placeholder="e.g., Equity Derivatives Risk Associate (NISM Series VIII)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Required Concepts &amp; Minimum Scores
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addConceptRow}
                  disabled={submitting || rows.length >= 6}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Concept
                </Button>
              </div>

              <div className="space-y-2.5">
                {rows.map((row, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-border bg-muted/40 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                  >
                    <select
                      value={row.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      disabled={submitting}
                      className="flex-1 h-11 rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      {catalog.map((conceptName) => (
                        <option key={conceptName} value={conceptName}>
                          {conceptName}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                        Min Score:
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={row.min_score}
                        onChange={(e) =>
                          updateRow(idx, {
                            min_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                          })
                        }
                        disabled={submitting}
                        className="w-24 font-mono text-center"
                      />
                      {rows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeConceptRow(idx)}
                          disabled={submitting}
                          aria-label="Remove concept"
                        >
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && <ErrorBanner message={error} onRetry={loadDashboard} />}

            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={submitting}>
                {submitting ? (
                  <Spinner size="sm" label="Creating & matching..." className="text-white" />
                ) : (
                  <>
                    Create Requisition &amp; View Matches <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Existing Requisitions List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Your Open Requisitions ({requisitions.length})</CardTitle>
          <CardDescription>
            Click any requisition to inspect ranked, opt-in verified candidates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requisitions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No requisitions created yet — create one above to rank matching verified candidates.
            </p>
          ) : (
            <div className="space-y-3">
              {requisitions.map((req) => (
                <div
                  key={req.id}
                  className="rounded-xl border border-border bg-muted/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-foreground">{req.title}</span>
                      <Badge variant="success" className="text-[10.5px]">
                        <CheckCircle2 className="h-3 w-3" /> {req.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(req.required_concepts || []).map((rc) => (
                        <Badge key={rc.name} variant="secondary" className="text-[11px] font-mono">
                          {rc.name} ≥ {rc.min_score}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onSelectRequisition(req)}
                    className="shrink-0"
                  >
                    <Users className="h-4 w-4" /> View Matches <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
