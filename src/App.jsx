import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  storeGet,
  storeSet,
  storeList,
  configured as hasStore,
} from "./storageClient";

/* ----------------------------- helpers ----------------------------- */

const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2, 9));

// Parse amounts written the Argentine way: 1.234,56  ->  1234.56
function parseAmount(s) {
  if (s == null) return 0;
  let t = String(s).trim();
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n) => ars.format(n || 0);

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const labelMonth = (y, m) => `${MESES[m]} ${y}`;
const monthKey = (y, m) => `bs_exp_${y}_${String(m + 1).padStart(2, "0")}`;
// clasifica un gasto como "servicio" (boleta fija) u "otro"
const SERVICIOS = new Set(["absa", "camuzzi", "edelap", "telecentro"]);
const SERV_NOTES = new Set(["agua", "gas", "luz", "electricidad", "internet"]);
function isServicio(e) {
  const n = (e.name || "").trim().toLowerCase();
  const note = (e.note || "").trim().toLowerCase();
  return SERVICIOS.has(n) || SERV_NOTES.has(note);
}
function splitTotals(exps) {
  let serv = 0,
    otros = 0;
  (exps || []).forEach((e) => {
    const a = parseAmount(e.amount);
    if (isServicio(e)) serv += a;
    else otros += a;
  });
  return { serv, otros, total: serv + otros };
}

const prevMonth = (y, m) => (m === 0 ? [y - 1, 11] : [y, m - 1]);

// devuelve n meses terminando en (y,m): [mas viejo ... elegido]
function monthsBack(y, m, n) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i,
      yy = y;
    while (mm < 0) {
      mm += 12;
      yy -= 1;
    }
    arr.push({ y: yy, m: mm });
  }
  return arr;
}

// unidad de consumo para luz/gas (o null)
function utilUnit(e) {
  const n = (e.name || "").toLowerCase();
  const note = (e.note || "").toLowerCase();
  if (n.includes("edelap") || note.includes("luz") || note.includes("electric")) return "kWh";
  if (n.includes("camuzzi") || note.includes("gas")) return "m³";
  return null;
}

const PERSON_COLORS = [
  "#73A6AD", "#D8A7CA", "#9B97B2", "#C7B8EA", "#5FC8C2", "#B98AC9",
];
const colorOf = (i) => PERSON_COLORS[i % PERSON_COLORS.length];
const initials = (name) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/* ------------------------- persistent storage ------------------------- */

/* ------------------- almacenamiento: ./storageClient.js (Supabase) ------------------- */

/* ------------------------------- seeds ------------------------------- */

function seedPeople() {
  return [
    { id: uid(), name: "Yo", color: 0, splits: true },
    { id: uid(), name: "Bele", color: 1, splits: true },
    { id: uid(), name: "Mamá", color: 2, splits: false },
  ];
}

// Recurring bills she pays every month. Amounts pre-filled only for June 2026.
function seedExpenses(people, isJune) {
  const sisters = people.filter((p) => p.splits).map((p) => p.id);
  const mama = (people.find((p) => !p.splits) || {}).id || null;
  const yo = sisters[0] || null;
  const mk = (name, note, amount, paidBy) => ({
    id: uid(),
    name,
    note,
    amount,
    paidBy,
    parts: [...sisters],
  });
  const list = [
    mk("ABSA", "Agua", isJune ? "11000" : "", mama),
    mk("Camuzzi", "Gas", isJune ? "27772" : "", mama),
    mk("Edelap", "Luz", isJune ? "77638" : "", mama),
    mk("Telecentro", "Internet", isJune ? "22000" : "", yo), // no va a mamá
  ];
  if (isJune)
    list.push(mk("Bordeadora cuota 2/3", "Compra compartida", "27200", yo));
  return list;
}

/* ------------------------------- app ------------------------------- */

export default function App() {
  const now = new Date();
  const [people, setPeople] = useState(null);
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [expenses, setExpenses] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [history, setHistory] = useState([]);
  const [banner, setBanner] = useState("");
  const [chartCat, setChartCat] = useState("todo"); // todo | servicios | otros
  const ready = useRef(false);
  const peopleT = useRef();
  const expT = useRef();
  const peopleRef = useRef(null);
  const peopleLoaded = !!people;

  // read every saved month and total it, for the per-month chart
  const loadHistory = React.useCallback(async () => {
    if (!hasStore) {
      setHistory([]);
      return;
    }
    let keys = [];
    try {
      keys = await storeList("bs_exp_");
    } catch (e) {
      keys = [];
    }
    const out = [];
    for (const key of keys) {
      const mm = /bs_exp_(\d{4})_(\d{2})/.exec(key);
      if (!mm) continue;
      const y = +mm[1],
        m = +mm[2] - 1;
      let total = 0,
        serv = 0;
      try {
        const raw = await storeGet(key);
        const arr = raw ? JSON.parse(raw) : [];
        arr.forEach((e) => {
          const a = parseAmount(e.amount);
          total += a;
          if (isServicio(e)) serv += a;
        });
      } catch (e) {}
      out.push({ key, y, m, total, serv, otros: total - serv });
    }
    out.sort((a, b) => (a.y === b.y ? a.m - b.m : a.y - b.y));
    setHistory(out);
  }, []);

  // re-read shared data when coming back to the screen (sync with sister)
  const reloadFromStore = React.useCallback(async () => {
    if (!hasStore || !people) return;
    ready.current = false;
    try {
      const praw = await storeGet("bs_people");
      if (praw) {
        const p = JSON.parse(praw);
        if (p && p.length) setPeople(p);
      }
    } catch (e) {}
    try {
      const raw = await storeGet(monthKey(view.y, view.m));
      if (raw) {
        const e = JSON.parse(raw);
        setExpenses(e);
      }
    } catch (e) {}
    loadHistory();
    setTimeout(() => (ready.current = true), 0);
  }, [people, view.y, view.m, loadHistory]);

  // load people once
  useEffect(() => {
    (async () => {
      const raw = await storeGet("bs_people");
      let p = null;
      try {
        p = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      if (!p || !p.length) {
        p = seedPeople();
        await storeSet("bs_people", JSON.stringify(p));
      }
      setPeople(p);
    })();
  }, []);

  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  // load expenses whenever month (or people) becomes available / changes
  useEffect(() => {
    if (!peopleLoaded) return;
    let alive = true;
    (async () => {
      setLoading(true);
      ready.current = false;
      const key = monthKey(view.y, view.m);
      const raw = await storeGet(key);
      let e = null;
      try {
        e = raw ? JSON.parse(raw) : null;
      } catch (err) {}
      if (!e) {
        const isJune = view.y === 2026 && view.m === 5;
        e = seedExpenses(peopleRef.current || [], isJune);
        await storeSet(key, JSON.stringify(e));
      }
      if (!alive) return;
      setExpenses(e);
      setLoading(false);
      setTimeout(() => (ready.current = true), 0);
    })();
    return () => {
      alive = false;
    };
  }, [peopleLoaded, view.y, view.m]);

  // persist
  useEffect(() => {
    if (!people || !ready.current) return;
    clearTimeout(peopleT.current);
    peopleT.current = setTimeout(() => {
      storeSet("bs_people", JSON.stringify(people));
    }, 500);
    return () => clearTimeout(peopleT.current);
  }, [people]);
  useEffect(() => {
    if (!expenses || !ready.current) return;
    const key = monthKey(view.y, view.m);
    clearTimeout(expT.current);
    expT.current = setTimeout(async () => {
      await storeSet(key, JSON.stringify(expenses));
      loadHistory();
    }, 600);
    return () => clearTimeout(expT.current);
  }, [expenses]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory, view.y, view.m]);

  useEffect(() => {
    const onStatus = (e) => setBanner(e.detail || "");
    window.addEventListener("store-status", onStatus);
    return () => window.removeEventListener("store-status", onStatus);
  }, []);

  const note = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2200);
  };

  /* ----------------------------- calc ----------------------------- */
  const calc = useMemo(() => {
    const empty = {
      total: 0,
      servTotal: 0,
      otrosTotal: 0,
      share: {},
      paid: {},
      net: {},
      transfers: [],
      pending: [],
    };
    if (!people || !expenses) return empty;

    const valid = (id) => people.some((p) => p.id === id);
    const splitsOk = (id) => people.some((p) => p.id === id && p.splits);

    const share = {},
      paid = {};
    people.forEach((p) => {
      share[p.id] = 0;
      paid[p.id] = 0;
    });

    let total = 0;
    let servTotal = 0;
    const pending = [];

    expenses.forEach((e) => {
      const amt = parseAmount(e.amount);
      total += amt;
      if (isServicio(e)) servTotal += amt;
      if (amt <= 0) return;
      const hasPayer = e.paidBy && valid(e.paidBy);
      if (!hasPayer) {
        pending.push(e.id);
        return; // excluded from settlement until a payer is chosen
      }
      const parts = (e.parts || []).filter(splitsOk);
      if (parts.length) {
        const sh = amt / parts.length;
        parts.forEach((id) => (share[id] += sh));
      }
      paid[e.paidBy] += amt;
    });

    const net = {};
    people.forEach((p) => (net[p.id] = paid[p.id] - share[p.id]));

    // greedy settlement
    const creditors = people
      .filter((p) => net[p.id] > 0.005)
      .map((p) => ({ id: p.id, v: net[p.id] }))
      .sort((a, b) => b.v - a.v);
    const debtors = people
      .filter((p) => net[p.id] < -0.005)
      .map((p) => ({ id: p.id, v: -net[p.id] }))
      .sort((a, b) => b.v - a.v);
    const transfers = [];
    let i = 0,
      j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].v, creditors[j].v);
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: amt });
      debtors[i].v -= amt;
      creditors[j].v -= amt;
      if (debtors[i].v < 0.005) i++;
      if (creditors[j].v < 0.005) j++;
    }

    return { total, servTotal, otrosTotal: total - servTotal, share, paid, net, transfers, pending };
  }, [people, expenses]);

  const personById = (id) => (people || []).find((p) => p.id === id);
  const nameById = (id) => (personById(id) || {}).name || "—";

  /* --------------------------- mutations --------------------------- */
  const splitters = (people || []).filter((p) => p.splits);

  // resumen (planilla style)
  const entreUstedes = splitters.reduce((s, p) => s + (calc.paid[p.id] || 0), 0);
  const balanceList = [
    ...splitters,
    ...(people || []).filter((p) => !p.splits && ((calc.paid[p.id] || 0) > 0 || (calc.net[p.id] || 0) !== 0)),
  ];

  // chart: el mes elegido + 5 meses para atrás (6 barras), filtrado por categoría
  const compact = (n) =>
    n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + Math.round(n);
  const ymOf = (y, m) => y * 100 + (m + 1);
  const pickCat = (o) =>
    chartCat === "servicios"
      ? o.serv || 0
      : chartCat === "otros"
      ? o.otros || 0
      : o.total || 0;
  const histMap = {};
  history.forEach((h) => {
    histMap[ymOf(h.y, h.m)] = h;
  });
  const curObj = {
    total: calc.total,
    serv: calc.servTotal,
    otros: calc.otrosTotal,
  };
  const histData = monthsBack(view.y, view.m, 6).map((s) => {
    const isCur = s.y === view.y && s.m === view.m;
    const o = isCur ? curObj : histMap[ymOf(s.y, s.m)] || { total: 0, serv: 0, otros: 0 };
    return { y: s.y, m: s.m, total: pickCat(o) };
  });
  const maxT = Math.max(1, ...histData.map((h) => h.total));

  const addExpense = () => {
    const sisters = splitters.map((p) => p.id);
    setExpenses((es) => [
      ...es,
      { id: uid(), name: "", note: "", amount: "", paidBy: null, parts: sisters },
    ]);
  };
  const updateExpense = (id, patch) =>
    setExpenses((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeExpense = (id) =>
    setExpenses((es) => es.filter((e) => e.id !== id));
  const togglePart = (id, pid) =>
    setExpenses((es) =>
      es.map((e) => {
        if (e.id !== id) return e;
        const has = e.parts.includes(pid);
        return { ...e, parts: has ? e.parts.filter((x) => x !== pid) : [...e.parts, pid] };
      })
    );

  const addPerson = () => {
    setPeople((ps) => {
      const color = ps.length;
      const np = { id: uid(), name: "Nuevo", color, splits: true };
      return [...ps, np];
    });
  };
  const updatePerson = (id, patch) =>
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removePerson = (id) => {
    setPeople((ps) => ps.filter((p) => p.id !== id));
    setExpenses((es) =>
      es.map((e) => ({
        ...e,
        paidBy: e.paidBy === id ? null : e.paidBy,
        parts: e.parts.filter((x) => x !== id),
      }))
    );
  };

  const exportExcel = async () => {
    try {
      note("Armando Excel…");
      const ExcelJS = (await import("exceljs")).default;
      const keys = await storeList("bs_exp_");
      const months = [];
      for (const k of keys) {
        const mm = /bs_exp_(\d{4})_(\d{2})/.exec(k);
        if (!mm) continue;
        const raw = await storeGet(k);
        let exps = [];
        try {
          exps = raw ? JSON.parse(raw) : [];
        } catch (e) {}
        months.push({ y: +mm[1], m: +mm[2] - 1, exps });
      }
      months.sort((a, b) => (a.y === b.y ? a.m - b.m : a.y - b.y));
      const sp = people.filter((p) => p.splits);
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

      const CUR = '"$ "#,##0.00';
      const TEAL = "FF2F5E66",
        LAV = "FFEDE6F8",
        BAND = "FFF6F3FB",
        WHITE = "FFFFFFFF";
      const thin = { style: "thin", color: { argb: "FFE0DBEC" } };
      const allB = { top: thin, left: thin, bottom: thin, right: thin };

      const wb = new ExcelJS.Workbook();
      wb.creator = "Cuentas de casa";

      const titleHeader = (ws, head, title) => {
        ws.mergeCells(1, 1, 1, head.length);
        const t = ws.getCell(1, 1);
        t.value = title;
        t.font = { bold: true, size: 14, color: { argb: TEAL } };
        t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LAV } };
        t.alignment = { vertical: "middle" };
        ws.getRow(1).height = 26;
        const hr = ws.getRow(2);
        hr.values = head;
        hr.height = 18;
        hr.eachCell((c) => {
          c.font = { bold: true, color: { argb: WHITE } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
          c.alignment = { horizontal: "center", vertical: "middle" };
          c.border = allB;
        });
      };

      // ---- Planilla (formato tipo tu planilla original) ----
      const GREEN = "FFDDEBD8",
        ORANGE = "FFF3C99A";
      const pl = wb.addWorksheet("Planilla");
      pl.mergeCells(1, 1, 1, 3);
      const plt = pl.getCell(1, 1);
      plt.value = "Cuentas de casa · Planilla";
      plt.font = { bold: true, size: 14, color: { argb: TEAL } };
      plt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LAV } };
      plt.alignment = { vertical: "middle" };
      pl.getRow(1).height = 26;
      pl.getColumn(1).width = 32;
      pl.getColumn(2).width = 16;
      pl.getColumn(3).width = 16;
      let pr = 3;
      months.forEach(({ y, m, exps }) => {
        const items = exps.filter((e) => e.name && parseAmount(e.amount) > 0);
        if (!items.length) return;
        pl.mergeCells(pr, 1, pr, 3);
        const mt = pl.getCell(pr, 1);
        mt.value = cap(MESES[m]) + " " + y;
        mt.font = { bold: true, color: { argb: TEAL } };
        mt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LAV } };
        pr++;
        let total = 0;
        items.forEach((e) => {
          const a = parseAmount(e.amount);
          total += a;
          const row = pl.getRow(pr);
          row.getCell(1).value = e.name;
          row.getCell(2).value = a;
          row.getCell(2).numFmt = CUR;
          [1, 2, 3].forEach((ci) => {
            const c = row.getCell(ci);
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
            c.border = allB;
          });
          pr++;
        });
        const mkTot = (label, val) => {
          const row = pl.getRow(pr);
          row.getCell(1).value = label;
          row.getCell(2).value = val;
          row.getCell(2).numFmt = CUR;
          [1, 2, 3].forEach((ci) => {
            const c = row.getCell(ci);
            c.font = { bold: true };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
            c.border = allB;
          });
          pr++;
        };
        mkTot("TOTAL " + MESES[m].toUpperCase(), total);
        mkTot("TOTAL ÷ 2", total / 2);
        pr++; // fila en blanco entre meses
      });
      pl.views = [{ state: "frozen", ySplit: 1 }];

      // ---- Resumen ----
      const r = wb.addWorksheet("Resumen");
      const rHead = ["Año", "Mes", "Total", ...sp.map((p) => p.name)];
      titleHeader(r, rHead, "Cuentas de casa · Resumen por mes");
      let totalAll = 0;
      const sumP = {};
      sp.forEach((p) => (sumP[p.id] = 0));
      months.forEach(({ y, m, exps }) => {
        let total = 0;
        const share = {};
        sp.forEach((p) => (share[p.id] = 0));
        exps.forEach((e) => {
          const a = parseAmount(e.amount);
          total += a;
          const parts = (e.parts || []).filter((id) => sp.some((p) => p.id === id));
          if (a > 0 && parts.length) {
            const s = a / parts.length;
            parts.forEach((id) => (share[id] += s));
          }
        });
        if (total <= 0) return;
        totalAll += total;
        sp.forEach((p) => (sumP[p.id] += share[p.id]));
        const row = r.addRow([y, cap(MESES[m]), total, ...sp.map((p) => share[p.id])]);
        for (let i = 3; i <= rHead.length; i++) row.getCell(i).numFmt = CUR;
        row.getCell(1).numFmt = "0";
      });
      const tr = r.addRow(["", "TOTAL", totalAll, ...sp.map((p) => sumP[p.id])]);
      tr.eachCell((c) => {
        c.font = { bold: true };
        c.border = { top: { style: "thin", color: { argb: TEAL } } };
      });
      for (let i = 3; i <= rHead.length; i++) tr.getCell(i).numFmt = CUR;
      r.getColumn(1).width = 8;
      r.getColumn(2).width = 14;
      r.getColumn(3).width = 16;
      sp.forEach((p, i) => (r.getColumn(4 + i).width = 14));
      r.views = [{ state: "frozen", ySplit: 2 }];

      // ---- Detalle ----
      const d = wb.addWorksheet("Detalle");
      const dHead = ["Año", "Mes", "Concepto", "Categoría", "Monto", "Pagó", "Dividen", "Consumo"];
      titleHeader(d, dHead, "Cuentas de casa · Detalle de gastos");
      months.forEach(({ y, m, exps }) => {
        exps.forEach((e) => {
          const a = parseAmount(e.amount);
          if (!e.name && !a) return;
          const cons = e.consumo
            ? isNaN(parseAmount(e.consumo))
              ? e.consumo
              : parseAmount(e.consumo)
            : "";
          const row = d.addRow([
            y,
            cap(MESES[m]),
            e.name || "",
            e.note || "",
            a,
            nameById(e.paidBy),
            (e.parts || []).map(nameById).join(", "),
            cons,
          ]);
          row.getCell(1).numFmt = "0";
          row.getCell(5).numFmt = CUR;
        });
      });
      d.eachRow((row, idx) => {
        if (idx >= 3 && idx % 2 === 1)
          row.eachCell((c) => {
            if (!c.fill || !c.fill.fgColor)
              c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
          });
      });
      [8, 14, 26, 20, 16, 12, 22, 14].forEach((w, i) => (d.getColumn(i + 1).width = w));
      d.views = [{ state: "frozen", ySplit: 2 }];
      d.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: dHead.length } };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cuentas-casa-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      note("¡Excel descargado!");
    } catch (e) {
      note("No se pudo armar el Excel");
    }
  };

  const changeMonth = (delta) => {
    setView((v) => {
      let m = v.m + delta,
        y = v.y;
      if (m < 0) {
        m = 11;
        y--;
      } else if (m > 11) {
        m = 0;
        y++;
      }
      return { y, m };
    });
  };

  const copyLastMonth = async () => {
    const [py, pm] = prevMonth(view.y, view.m);
    const raw = await storeGet(monthKey(py, pm));
    if (!raw) {
      note("No hay datos del mes anterior");
      return;
    }
    let prev = [];
    try {
      prev = JSON.parse(raw);
    } catch (e) {}
    if (!prev.length) {
      note("El mes anterior está vacío");
      return;
    }
    const copy = prev.map((e) => ({ ...e, id: uid(), amount: "" }));
    setExpenses(copy);
    note("Copié los gastos, cargá los montos nuevos");
  };

  /* ----------------------------- render ----------------------------- */
  if (!hasStore) {
    return (
      <div className="bs">
        <style>{CSS}</style>
        <div className="wrap">
          <div className="card setup">
            <h2>Falta conectar la base 🔌</h2>
            <p className="muted">
              Para que vos y tu hermana vean los mismos datos, esta app se conecta
              a Supabase. Todavía no cargaste las claves.
            </p>
            <ol>
              <li>Creá un proyecto gratis en <b>supabase.com</b>.</li>
              <li>
                En el archivo <code>.env</code> de este proyecto poné tus dos
                claves (mirá <code>.env.example</code> y el <code>README.md</code>).
              </li>
              <li>Volvé a correr <code>npm run dev</code>.</li>
            </ol>
            <p className="muted">Está todo explicado paso a paso en el README.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !people || !expenses) {
    return (
      <div className="bs">
        <style>{CSS}</style>
        <div className="loadwrap">
          <div className="spinner" />
          <p>Cargando tus cuentas…</p>
        </div>
      </div>
    );
  }

  const allPayers = people; // mamá can be a payer even if she doesn't split

  return (
    <div className="bs">
      <style>{CSS}</style>

      <div className="wrap">
        {banner && (
          <div className="errbar">
            ⚠️ La base devolvió un error y por eso no se guarda: {banner}
          </div>
        )}
        {/* header */}
        <header className="head">
          <div className="brand">
            <span className="brand-mark">◷</span> Cuentas de casa
          </div>
          <div className="monthnav">
            <button aria-label="Mes anterior" onClick={() => changeMonth(-1)}>‹</button>
            <span className="month">{labelMonth(view.y, view.m)}</span>
            <button aria-label="Mes siguiente" onClick={() => changeMonth(1)}>›</button>
          </div>
          <button
            className="refresh"
            aria-label="Actualizar"
            title="Traer lo último"
            onClick={() => {
              reloadFromStore();
              note("Actualizado");
            }}
          >
            ⟳
          </button>
        </header>

        <div className="grid">
          <div className="col-side">

        {/* summary */}
        <section className="summary">
          <div className="total">
            <span className="total-lbl">Total del mes</span>
            <span className="total-val">{fmt(calc.total)}</span>
            <span className="total-sub">
              se reparte entre {splitters.length}{" "}
              {splitters.length === 1 ? "persona" : "personas"}
            </span>
          </div>
        </section>

        {/* resumen estilo planilla */}
        <section className="card resumen">
          <h2>
            Resumen de{" "}
            <span style={{ textTransform: "capitalize" }}>{MESES[view.m]}</span>
          </h2>
          <div className="rrow">
            <span>Total del mes</span>
            <b>{fmt(calc.total)}</b>
          </div>
          {people
            .filter((p) => !p.splits && (calc.paid[p.id] || 0) > 0)
            .map((p) => (
              <div className="rrow" key={p.id}>
                <span>A pagarle a {p.name}</span>
                <b>{fmt(calc.paid[p.id])}</b>
              </div>
            ))}
          {entreUstedes > 0 && (
            <div className="rrow">
              <span>Entre {splitters.map((s) => s.name).join(" y ")}</span>
              <b>{fmt(entreUstedes)}</b>
            </div>
          )}
          {splitters.length > 0 && (
            <div className="rrow div">
              <span>Por persona (÷{splitters.length})</span>
              <b>{fmt(calc.total / splitters.length)}</b>
            </div>
          )}
          <div className="rtable">
            {balanceList.map((p) => {
              const net = calc.net[p.id] || 0;
              const cls = net > 0.5 ? "get" : net < -0.5 ? "pay" : "ok";
              const txt =
                net > 0.5
                  ? "recibe " + fmt(net)
                  : net < -0.5
                  ? "paga " + fmt(-net)
                  : "al día";
              const sub = p.splits
                ? "le toca " +
                  fmt(calc.share[p.id] || 0) +
                  ((calc.paid[p.id] || 0) > 0
                    ? " · adelantó " + fmt(calc.paid[p.id])
                    : "")
                : "adelantó " + fmt(calc.paid[p.id] || 0);
              return (
                <div className="prow" key={p.id}>
                  <span className="ava sm" style={{ background: colorOf(p.color) }}>
                    {initials(p.name)}
                  </span>
                  <span className="pn">{p.name}</span>
                  <span className="ps">{sub}</span>
                  <span className={"saldo " + cls}>{txt}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* chart */}
        <section className="card chart-card">
          <div className="card-head">
            <h2>Gasto por mes</h2>
            <button className="ghost" onClick={exportExcel}>Exportar Excel</button>
          </div>
          <div className="catbtns">
            {[
              ["todo", "Todo"],
              ["servicios", "Servicios"],
              ["otros", "Otros"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                className={"chip" + (chartCat === k ? " sel" : "")}
                style={
                  chartCat === k
                    ? { background: "#C7B8EA", borderColor: "#C7B8EA", color: "#2E2A3A" }
                    : {}
                }
                onClick={() => setChartCat(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="chart">
            {histData.map((h) => {
              const active = h.y === view.y && h.m === view.m;
              const hpx = Math.max(3, Math.round((h.total / maxT) * 108));
              return (
                <button
                  key={h.y + "-" + h.m}
                  className={"bar-col" + (active ? " active" : "")}
                  onClick={() => setView({ y: h.y, m: h.m })}
                  title={labelMonth(h.y, h.m) + ": " + fmt(h.total)}
                >
                  <span className="bar-val">{h.total > 0 ? compact(h.total) : ""}</span>
                  <span className="bar-track">
                    <span className="bar" style={{ height: hpx + "px" }} />
                  </span>
                  <span className="bar-x">
                    {MESES[h.m].slice(0, 3)}
                    {h.m === 0 ? " '" + String(h.y).slice(2) : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hint">Muestra el mes que estás viendo y los 5 anteriores. Tocá una barra para ir a ese mes.</p>
        </section>

        {/* settlement */}
        <section className="card settle">
          <h2>Quién le paga a quién</h2>
          {calc.transfers.length === 0 ? (
            <p className="muted">Cuando cargues montos, acá aparece el resumen de transferencias.</p>
          ) : (
            <ul className="tx">
              {calc.transfers.map((t, i) => (
                <li key={i}>
                  <span className="tx-from">
                    <span className="dot" style={{ background: colorOf((personById(t.from) || {}).color || 0) }} />
                    {nameById(t.from)}
                  </span>
                  <span className="arrow">→</span>
                  <span className="tx-to">
                    {nameById(t.to)}
                    <span className="dot" style={{ background: colorOf((personById(t.to) || {}).color || 0) }} />
                  </span>
                  <span className="tx-amt">{fmt(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {calc.pending.length > 0 && (
            <p className="warn">
              Hay {calc.pending.length} gasto{calc.pending.length > 1 ? "s" : ""} sin definir quién lo adelantó — elegí “Pagó” para sumarlo al cálculo.
            </p>
          )}
        </section>
          </div>

          <div className="col-main">

        {/* people */}
        <section className="card people">
          <div className="card-head">
            <h2>Personas</h2>
            <button className="ghost" onClick={addPerson}>+ Agregar</button>
          </div>
          <ul className="plist">
            {people.map((p) => (
              <li key={p.id}>
                <span className="ava sm" style={{ background: colorOf(p.color) }}>
                  {initials(p.name)}
                </span>
                <input
                  className="pname"
                  value={p.name}
                  onChange={(ev) => updatePerson(p.id, { name: ev.target.value })}
                  placeholder="Nombre"
                />
                <button
                  className={"chip toggle" + (p.splits ? " on" : "")}
                  onClick={() => updatePerson(p.id, { splits: !p.splits })}
                  title="Si divide gastos o solo adelanta plata"
                >
                  {p.splits ? "divide" : "solo adelanta"}
                </button>
                {people.length > 1 && (
                  <button className="x" onClick={() => removePerson(p.id)} aria-label="Quitar">×</button>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">
            “Solo adelanta” es para alguien como mamá: pone la plata pero no divide gastos, así cada una le reintegra.
          </p>
        </section>

        {/* expenses */}
        <section className="card expenses">
          <div className="card-head">
            <h2>Gastos</h2>
            <div className="head-actions">
              <button className="ghost" onClick={copyLastMonth}>Copiar mes anterior</button>
              <button className="solid" onClick={addExpense}>+ Gasto</button>
            </div>
          </div>

          {expenses.map((e) => {
            const amt = parseAmount(e.amount);
            const noPayer = amt > 0 && !(e.paidBy && personById(e.paidBy));
            return (
              <div className="exp" key={e.id}>
                <div className="exp-top">
                  <div className="exp-name">
                    <input
                      value={e.name}
                      onChange={(ev) => updateExpense(e.id, { name: ev.target.value })}
                      placeholder="Concepto"
                    />
                    <input
                      className="exp-note"
                      value={e.note || ""}
                      onChange={(ev) => updateExpense(e.id, { note: ev.target.value })}
                      placeholder="nota (luz, gas…)"
                    />
                  </div>
                  <div className="exp-amt">
                    <span className="cur">$</span>
                    <input
                      inputMode="decimal"
                      value={e.amount}
                      onChange={(ev) => updateExpense(e.id, { amount: ev.target.value })}
                      placeholder="0,00"
                    />
                  </div>
                  <button className="x" onClick={() => removeExpense(e.id)} aria-label="Borrar gasto">×</button>
                </div>

                <div className="exp-row">
                  <span className="row-lbl">Pagó</span>
                  <div className="chips">
                    {allPayers.map((p) => (
                      <button
                        key={p.id}
                        className={"chip" + (e.paidBy === p.id ? " sel" : "")}
                        style={e.paidBy === p.id ? { background: colorOf(p.color), borderColor: colorOf(p.color), color: "#2E2A3A" } : {}}
                        onClick={() =>
                          updateExpense(e.id, { paidBy: e.paidBy === p.id ? null : p.id })
                        }
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="exp-row">
                  <span className="row-lbl">Dividen</span>
                  <div className="chips">
                    {splitters.map((p) => {
                      const on = e.parts.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          className={"chip" + (on ? " sel" : "")}
                          style={on ? { background: colorOf(p.color), borderColor: colorOf(p.color), color: "#2E2A3A" } : {}}
                          onClick={() => togglePart(e.id, p.id)}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {utilUnit(e) && (
                  <div className="exp-row">
                    <span className="row-lbl">Consumo</span>
                    <div className="consumo">
                      <input
                        className="cons-in"
                        inputMode="decimal"
                        value={e.consumo || ""}
                        onChange={(ev) => updateExpense(e.id, { consumo: ev.target.value })}
                        placeholder="0"
                      />
                      <span className="cons-u">{utilUnit(e)}</span>
                    </div>
                  </div>
                )}

                {noPayer && <p className="exp-warn">Elegí quién adelantó la plata</p>}
              </div>
            );
          })}
        </section>
          </div>
        </div>

        <footer className="foot">
          Los datos se guardan por mes en esta app. Cambiá de mes con las flechas de arriba.
        </footer>
      </div>

      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}

/* ------------------------------- styles ------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');

.bs *{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0;background:#F4F2FB}
.bs{
  --paper:#F4F2FB; --card:#FFFFFF; --ink:#2E2A3A; --soft:#6B6780;
  --line:#E4DEF2; --green:#43808A; --green-d:#2F5E66; --signal:#B85A8E;
  font-family:Inter,system-ui,sans-serif; color:var(--ink);
  background:var(--paper); min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.bs button{font-family:inherit;cursor:pointer}
.bs input{font-family:inherit}
.bs input:focus-visible,.bs button:focus-visible{outline:2px solid var(--green);outline-offset:1px}

.wrap{max-width:560px;margin:0 auto;padding:16px 14px 80px}
.grid{display:flex;flex-direction:column}
.col-side,.col-main{min-width:0}

@media (min-width:900px){
  .wrap{max-width:1080px}
  .grid{display:grid;grid-template-columns:350px 1fr;gap:20px;align-items:start}
}

/* header */
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.brand{font-family:Fraunces,serif;font-weight:600;font-size:20px;color:var(--green-d);display:flex;align-items:center;gap:7px}
.brand-mark{color:var(--signal);font-size:18px}
.monthnav{display:flex;align-items:center;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px}
.monthnav button{width:30px;height:30px;border:none;background:transparent;border-radius:999px;font-size:20px;line-height:1;color:var(--green-d)}
.monthnav button:hover{background:var(--paper)}
.month{font-size:13px;font-weight:600;text-transform:capitalize;padding:0 6px;min-width:96px;text-align:center}

/* summary */
.summary{margin-bottom:14px}
.total{
  background:linear-gradient(135deg,#4EFFEF 0%,#C7B8EA 100%);color:#22323A;border-radius:18px;padding:18px 20px;
  display:flex;flex-direction:column;gap:2px;margin-bottom:10px;
  box-shadow:0 8px 24px -16px rgba(115,166,173,.7);
}
.total-lbl{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#3C6E74}
.total-val{font-family:Fraunces,serif;font-size:34px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.total-sub{font-size:12px;color:#3C6E74}

.shares{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.share{
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;
  display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;
  column-gap:9px;row-gap:1px;align-items:center;
}
.share .ava{grid-row:1/3}
.share-name{font-size:13px;font-weight:600}
.share-val{font-family:Fraunces,serif;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;grid-column:2}
.share-lbl{display:none}

.ava{width:30px;height:30px;border-radius:50%;color:#2E2A3A;font-size:12px;font-weight:600;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.ava.sm{width:26px;height:26px;font-size:11px}

/* cards */
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:14px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.card h2{font-family:Fraunces,serif;font-size:17px;font-weight:600;color:var(--green-d)}
.head-actions{display:flex;gap:6px}
.muted{color:var(--soft);font-size:13px}
.hint{font-size:11.5px;color:var(--soft);margin-top:10px;line-height:1.4}
.warn{font-size:12px;color:var(--signal);margin-top:10px;line-height:1.4}

/* buttons */
.ghost{border:1px solid var(--line);background:var(--card);color:var(--green-d);border-radius:999px;padding:6px 11px;font-size:12px;font-weight:600}
.ghost:hover{background:var(--paper)}
.solid{border:none;background:var(--green);color:#fff;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:600}
.solid:hover{background:var(--green-d)}
.x{border:none;background:transparent;color:var(--soft);font-size:21px;line-height:1;width:28px;height:28px;border-radius:8px;flex:none}
.x:hover{background:#F7E7F1;color:var(--signal)}

/* settlement */
.tx{list-style:none;display:flex;flex-direction:column;gap:8px}
.tx li{display:flex;align-items:center;gap:8px;background:var(--paper);border-radius:12px;padding:10px 12px;font-size:14px;flex-wrap:wrap}
.tx-from,.tx-to{display:flex;align-items:center;gap:6px;font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.arrow{color:var(--signal);font-weight:600}
.tx-amt{margin-left:auto;font-family:Fraunces,serif;font-weight:600;font-variant-numeric:tabular-nums}

/* people list */
.plist{list-style:none;display:flex;flex-direction:column;gap:8px}
.plist li{display:flex;align-items:center;gap:8px}
.pname{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;background:var(--paper);color:var(--ink)}
.toggle{flex:none}
.toggle.on{color:var(--green-d);border-color:var(--green);background:#E2F0F1}

/* expenses */
.exp{border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px;background:#FCFDFB}
.exp-top{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px}
.exp-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.exp-name input{border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;width:100%;color:var(--ink)}
.exp-name input.exp-note{font-size:11.5px;padding:5px 10px;color:var(--soft);background:var(--paper);border-style:dashed}
.exp-amt{display:flex;align-items:center;gap:2px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px;height:38px;width:118px;flex:none}
.exp-amt .cur{color:var(--soft);font-size:14px}
.exp-amt input{border:none;outline:none;width:100%;text-align:right;font-size:15px;font-variant-numeric:tabular-nums;background:transparent;color:var(--ink)}

.exp-row{display:flex;align-items:flex-start;gap:8px;margin-top:8px}
.row-lbl{font-size:11px;color:var(--soft);width:52px;flex:none;padding-top:7px;text-transform:uppercase;letter-spacing:.04em}
.chips{display:flex;flex-wrap:wrap;gap:6px;flex:1}
.chip{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:500}
.chip:hover{border-color:var(--green)}
.chip.sel{font-weight:600}
.exp-warn{font-size:11.5px;color:var(--signal);margin-top:8px}
.catbtns{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.consumo{display:flex;align-items:center;gap:6px;flex:1}
.cons-in{width:96px;border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:14px;background:#fff;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.cons-u{font-size:12px;color:var(--soft)}

.foot{text-align:center;font-size:11.5px;color:var(--soft);margin-top:8px;line-height:1.5}

/* resumen */
.resumen .rrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;font-size:14px;border-bottom:1px dashed var(--line)}
.resumen .rrow span{color:var(--soft)}
.resumen .rrow b{font-family:Fraunces,serif;font-variant-numeric:tabular-nums;font-weight:600}
.resumen .rrow.div{border-bottom:none;margin-top:2px}
.resumen .rrow.div span,.resumen .rrow.div b{color:var(--green-d);font-weight:600}
.rtable{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.prow{display:grid;grid-template-columns:auto 1fr auto;column-gap:9px;align-items:center;background:var(--paper);border-radius:12px;padding:9px 12px}
.prow .ava{grid-row:1/3}
.prow .pn{font-size:13.5px;font-weight:600;align-self:end}
.prow .ps{grid-column:2;font-size:11px;color:var(--soft);align-self:start;font-variant-numeric:tabular-nums}
.prow .saldo{grid-row:1/3;text-align:right;font-family:Fraunces,serif;font-weight:600;font-size:14px;white-space:nowrap}
.saldo.pay{color:var(--signal)}
.saldo.get{color:var(--green)}
.saldo.ok{color:var(--soft)}

/* chart */
.period{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.period label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--soft);text-transform:uppercase;letter-spacing:.04em}
.period select{border:1px solid var(--line);border-radius:10px;padding:7px 9px;font-size:13px;background:var(--card);color:var(--ink);font-family:inherit;text-transform:capitalize}
.chart{display:flex;align-items:flex-end;gap:4px;height:150px;padding-top:6px}
.bar-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:none;height:100%;justify-content:flex-end;padding:0}
.bar-val{font-size:9px;color:var(--soft);font-variant-numeric:tabular-nums;white-space:nowrap;height:12px}
.bar-track{display:flex;align-items:flex-end;height:108px}
.bar{width:24px;max-width:100%;border-radius:6px 6px 2px 2px;background:#C7B8EA;transition:height .25s ease}
.bar-col.active .bar{background:var(--green-d)}
.bar-col.active .bar-val{color:var(--green-d);font-weight:600}
.bar-x{font-size:10px;color:var(--soft);text-transform:capitalize}
.bar-col.active .bar-x{color:var(--green-d);font-weight:600}

.errbar{background:#FBE3EF;border:1px solid #E7A6CA;color:#8E2F63;border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px;line-height:1.45;word-break:break-word}
.refresh{width:34px;height:34px;border:1px solid var(--line);background:var(--card);border-radius:999px;font-size:17px;line-height:1;color:var(--green-d)}
.refresh:hover{background:var(--paper)}
.refresh:active{transform:rotate(180deg);transition:transform .3s ease}

.setup{margin-top:18px}
.setup h2{margin-bottom:8px}
.setup ol{margin:12px 0 6px;padding-left:20px;display:flex;flex-direction:column;gap:8px;font-size:14px}
.setup li{line-height:1.45}
.setup code{background:var(--paper);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px}

/* loading */
.loadwrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;color:var(--soft)}
.spinner{width:30px;height:30px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--green);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* flash */
.flash{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--green-d);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;box-shadow:0 10px 30px -12px rgba(0,0,0,.5);z-index:30}

@media (prefers-reduced-motion:reduce){.spinner{animation:none}}
`;
