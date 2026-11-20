"use client";

import React, { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  FileText,
  Upload,
  Sparkles,
  AlertCircle,
  ArrowRight,
  X,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  BookMarked,
} from "lucide-react";
import { ingestMaterial } from "../api.js";
import { preparePhotoForUpload } from "../lib/imageUtils.js";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Textarea } from "../components/ui/textarea.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";
import { Spinner } from "../components/ui/spinner.jsx";

const SAMPLE_PASSAGES = [
  {
    id: "mtm",
    module: "NISM Series VIII",
    title: "Mark-to-Market (MTM) Margin",
    preview: "Daily cash settlement of futures losses, maintenance margin calls & forced square-offs.",
    text: `In equity futures trading on NSE, traders deposit an Initial Margin (SPAN + Exposure margin, typically 15%–25% of contract value) rather than paying full contract value. At the end of every trading day, open futures positions are Marked-to-Market (MTM) against the daily settlement price. Any MTM loss is debited in cash from the trader's margin account on a T+0/T+1 basis. If the margin balance drops below the maintenance threshold during a sharp adverse move or circuit-breaker halt, the broker issues a margin call or automatically squares off the position—even if the trader expects prices to recover before expiry.`,
  },
  {
    id: "stoploss",
    module: "NISM Series VIII",
    title: "Stop-Loss & Overnight Gap Risk",
    preview: "Why an SL-M trigger never guarantees exit price when adverse news hits after market close.",
    text: `A Stop-Loss Market (SL-M) order becomes a market order only once the trigger price is crossed during active market hours. It does NOT guarantee execution at the trigger price. If adverse news breaks after market close—such as an accounting discrepancy or regulatory shock—the stock can open the next morning far below the stop-loss trigger (an overnight gap-down). The order then executes at the much lower opening price (or remains unfilled if locked in a lower circuit), realizing a loss far larger than the trader's planned stop.`,
  },
];

export default function Capture({ onIngested, initialText = "" }) {
  const [mode, setMode] = useState("text"); // "text" | "photo"
  const [text, setText] = useState(initialText);
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  async function handleFilePicked(file) {
    if (!file) return;
    setError("");
    setPreparingPhoto(true);
    try {
      const prepared = await preparePhotoForUpload(file);
      setPhoto({ ...prepared, name: file.name || "captured-page.jpg" });
      toast.success(`Photo optimized (${prepared.approxKB} KB JPEG) — ready to scan`);
    } catch (err) {
      setError(err.message || "Could not process selected photo.");
    } finally {
      setPreparingPhoto(false);
    }
  }

  function clearPhoto() {
    setPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (mode === "photo" && !photo) {
      setError("Take or upload a photo of a NISM study page first, or switch to Paste Text.");
      return;
    }
    if (mode === "text" && text.trim().length < 20) {
      setError("Paste at least a short paragraph of study material (20+ characters) or pick a sample below.");
      return;
    }

    setLoading(true);
    try {
      const data = await ingestMaterial(
        mode === "photo"
          ? { imageBase64: photo.imageBase64, mimeType: photo.mimeType }
          : { text: text.trim() }
      );
      onIngested(data);
    } catch (err) {
      setError(err.message || "Failed to extract concept. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Sparkles className="h-3.5 w-3.5" /> Step 1 · Capture Study Page
          </Badge>
          <span className="text-xs font-mono text-muted-foreground">
            Direct Gemini Multimodal · Zero OCR
          </span>
        </div>
        <CardTitle className="pt-1">What financial concept are you studying?</CardTitle>
        <CardDescription>
          Snap a photo of your NISM workbook page or paste a passage. Samajh extracts{" "}
          <span className="text-foreground font-semibold">one testable concept</span> and then
          verifies whether you actually understand the mechanism.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          {/* Segmented mode switcher */}
          <div className="inline-grid grid-cols-2 rounded-xl bg-muted p-1 border border-border w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setMode("text");
                setError("");
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                mode === "text"
                  ? "bg-card text-foreground shadow-sm border border-border/70"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Paste Text
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("photo");
                setError("");
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                mode === "photo"
                  ? "bg-card text-foreground shadow-sm border border-border/70"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Camera className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Page Photo
            </button>
          </div>

          {mode === "text" ? (
            <div className="space-y-4">
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSelectedSampleId(null);
                }}
                disabled={loading}
                rows={6}
                placeholder="Paste a paragraph from your NISM workbook (e.g. Mark-to-Market margin, stop-loss gap risk, option writing obligations, circuit filters)..."
              />

              {/* Interactive NISM Excerpt Cards */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <BookMarked className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Or try a real NISM Series VIII workbook excerpt:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SAMPLE_PASSAGES.map((sample) => {
                    const isSelected = selectedSampleId === sample.id;
                    return (
                      <button
                        key={sample.id}
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setText(sample.text);
                          setSelectedSampleId(sample.id);
                          setError("");
                        }}
                        className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer group ${
                          isSelected
                            ? "border-blue-500 bg-blue-50/80 dark:bg-blue-500/12 ring-1 ring-blue-500/30"
                            : "border-border bg-muted/40 hover:bg-muted/80 hover:border-blue-400/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] font-mono font-semibold text-blue-700 dark:text-blue-300">
                            {sample.module}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <div className="text-sm font-bold text-foreground group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          {sample.title}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                          {sample.preview}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFilePicked(e.target.files?.[0])}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="hidden"
                onChange={(e) => handleFilePicked(e.target.files?.[0])}
              />

              {photo ? (
                <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                  <div className="relative overflow-hidden rounded-xl border border-border bg-slate-950 flex justify-center">
                    <img
                      src={photo.previewUrl}
                      alt="Captured study page"
                      className="max-h-72 w-auto object-contain"
                    />
                    {loading && (
                      <div className="absolute inset-0 bg-blue-950/35 backdrop-blur-[1px] overflow-hidden flex items-center justify-center">
                        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-transparent via-blue-400/45 to-transparent animate-scan-beam" />
                        <div className="relative z-10 rounded-full bg-slate-900/90 border border-blue-400/40 px-4 py-1.5 text-xs font-semibold text-blue-200 flex items-center gap-2 shadow-lg">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                          Gemini reading page directly...
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Optimized ({photo.approxKB} KB JPEG) · {photo.name}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading}
                      onClick={clearPhoto}
                    >
                      <X className="h-3.5 w-3.5" /> Retake / Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!loading) handleFilePicked(e.dataTransfer.files?.[0]);
                  }}
                  className="rounded-2xl border-2 border-dashed border-border hover:border-blue-500/70 bg-muted/35 p-9 text-center transition-colors"
                >
                  {preparingPhoto ? (
                    <div className="py-4">
                      <Spinner size="lg" label="Optimizing photo for fast upload..." />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <div className="h-14 w-14 rounded-2xl bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-sm">
                        <ImageIcon className="h-7 w-7" />
                      </div>
                      <div className="space-y-1 max-w-md">
                        <p className="text-base font-bold text-foreground">
                          Snap a NISM workbook page or drop an image
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          Hold steady in clear lighting — if the page isn&apos;t legible, Samajh
                          will tell you instead of guessing.
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-3 flex-wrap pt-1">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <Camera className="h-4 w-4" /> Take Photo
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4" /> Choose File
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <ErrorBanner
              message={error}
              onRetry={() => setError("")}
              retryLabel="Dismiss"
              action={
                mode === "photo" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("text");
                      setError("");
                    }}
                    className="text-xs underline font-semibold hover:opacity-80 cursor-pointer"
                  >
                    Switch to Paste Text fallback →
                  </button>
                ) : null
              }
            />
          )}
        </CardContent>

        <CardFooter className="flex-col sm:flex-row items-stretch sm:items-center">
          <div className="text-xs font-mono text-muted-foreground">
            Pipeline: ingestAgent → conceptAgent
          </div>
          <Button type="submit" size="lg" disabled={loading || preparingPhoto}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === "photo" ? "Reading page & extracting..." : "Extracting concept..."}
              </>
            ) : (
              <>
                Extract Concept Card <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
