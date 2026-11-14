"use client";
import { useEffect, useState } from "react";
import { CompanyPageView } from "@/components/sentinel/company-page";

export default function CompanyPage() {
  const [symbol, setSymbol] = useState<string | null>(null);
  useEffect(() => { setSymbol((new URLSearchParams(window.location.search).get("symbol") || "").toUpperCase()); }, []);
  if (symbol === null) return null;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return <main className="mx-auto max-w-6xl p-6 text-sm text-muted-foreground"><a href="/" className="underline">Sentinel</a> · Choose a company from Brief, Discover or Following.</main>;
  return <CompanyPageView symbol={symbol} />;
}
