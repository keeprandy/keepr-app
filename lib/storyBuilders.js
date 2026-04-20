export function buildVehicleStory({
  asset,
  heroUri = null,
  records = [],
  systems = [],
  attachments = [],
  heroPlacementId = null,
}) {
  const title =
    [asset?.year, asset?.make, asset?.model].filter(Boolean).join(" ").trim() ||
    asset?.name ||
    "Vehicle";

  const totalSpend = records.reduce(
    (sum, r) => sum + (Number(r.cost || r.amount || 0) || 0),
    0
  );

  // Hero first, then curated showcase, then other photos

    const normalizedPhotos = (attachments || [])
    .filter((a) => !!a?.uri)
    .sort((a, b) => {
      const aHero = heroPlacementId && a?.placementId === heroPlacementId ? 1 : 0;
      const bHero = heroPlacementId && b?.placementId === heroPlacementId ? 1 : 0;
      if (aHero !== bHero) return bHero - aHero;

      const aShow = a?.isShowcase ? 1 : 0;
      const bShow = b?.isShowcase ? 1 : 0;
      if (aShow !== bShow) return bShow - aShow;

      const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bT - aT;
    });

  const showcasePhotos = normalizedPhotos.filter(
    (a) => a?.isShowcase || (heroPlacementId && a?.placementId === heroPlacementId)
  );

  const proofPhotos = showcasePhotos.map((a) => ({ uri: a.uri }));

  const systemMap = new Map();

  (systems || []).forEach((s) => {
    systemMap.set(s.id, {
      id: s.id,
      name: s.name || "System",
      lastEventTitle: null,
      lastEventDate: null,
      spend: 0,
      proofCount: 0,
    });
  });

  (records || []).forEach((r) => {
  const recordSystemId = r.system_id || r.systemId || null;
  const recordSystemName = (r.systemName || r.system_name || "").trim().toLowerCase();

  let current = null;

  if (recordSystemId && systemMap.has(recordSystemId)) {
    current = systemMap.get(recordSystemId);
  } else if (recordSystemName) {
    current =
      Array.from(systemMap.values()).find(
        (s) => String(s.name || "").trim().toLowerCase() === recordSystemName
      ) || null;
  }

  if (!current) return;

  const date = r.date || r.occurred_at || r.performed_at || r.created_at || null;
  const cost = Number(r.cost || r.amount || 0) || 0;

  current.spend += cost;

  if (!current.lastEventDate || (date && String(date) > String(current.lastEventDate))) {
    current.lastEventDate = date;
    current.lastEventTitle = r.title || r.name || "Service";
  }

  if (r.hasAttachment || r.proofCount || r.photoCount) {
    current.proofCount += Number(r.proofCount || r.photoCount || 1) || 1;
  }
});

  const enrichedSystems = Array.from(systemMap.values())
    .filter((s) => s.lastEventTitle || s.spend > 0 || s.proofCount > 0)
    .sort((a, b) => {
      const aSpend = Number(a.spend || 0);
      const bSpend = Number(b.spend || 0);
      return bSpend - aSpend;
    });

  const timeline = (records || [])
    .map((r) => ({
      id: r.id,
      date: r.date || r.occurred_at || r.performed_at || r.created_at,
      title: r.title || r.name || "Record",
      description: r.description || r.notes || "",
      kind: r.kind || "service",
      serviceType: r.serviceType || r.service_type || "service",
      cost: r.cost ?? r.amount ?? null,
      systemName: r.systemName || r.system_name || null,
      system_id: r.system_id || r.systemId || null,
      provider: r.provider || r.vendor || null,
      hasAttachment: !!(r.hasAttachment || r.proofCount || r.photoCount),
    }))
    .filter((r) => !!r.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    title,
    subtitle: "A documented story of care, upgrades, and ownership over time.",
    heroUri: heroUri || proofPhotos[0]?.uri || null,
    purchaseDate: asset?.purchase_date || null,
    purchasePrice: asset?.purchase_price || null,
    estimatedValue: asset?.estimated_value || null,
    documentedSpend: totalSpend,
    location: null,
    systems: enrichedSystems,
    proofPhotos,
    timeline,
    highlights: [],
    context: {
      assetType: "vehicle",
      vin: asset?.vin || null,
      mileage: asset?.current_odometer || null,
      engineHours: asset?.engine_hours || null,
    },
  };
}
export function buildBoatStory({
  asset,
  heroUri = null,
  records = [],
  systems = [],
  attachments = [],
  heroPlacementId = null,
}) {
  const title =
    [asset?.year, asset?.make, asset?.model].filter(Boolean).join(" ").trim() ||
    asset?.name ||
    "Boat";

  const totalSpend = records.reduce(
    (sum, r) => sum + (Number(r.cost || r.amount || 0) || 0),
    0
  );

  const normalizedPhotos = (attachments || [])
    .filter((a) => !!a?.uri)
    .sort((a, b) => {
      const aHero = heroPlacementId && a?.placementId === heroPlacementId ? 1 : 0;
      const bHero = heroPlacementId && b?.placementId === heroPlacementId ? 1 : 0;
      if (aHero !== bHero) return bHero - aHero;

      const aShow = a?.isShowcase ? 1 : 0;
      const bShow = b?.isShowcase ? 1 : 0;
      if (aShow !== bShow) return bShow - aShow;

      const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bT - aT;
    });

  const showcasePhotos = normalizedPhotos.filter(
    (a) => a?.isShowcase || (heroPlacementId && a?.placementId === heroPlacementId)
  );

  const proofPhotos = showcasePhotos.map((a) => ({ uri: a.uri }));

  const systemMap = new Map();

  (systems || []).forEach((s) => {
    systemMap.set(s.id, {
      id: s.id,
      name: s.name || "System",
      lastEventTitle: null,
      lastEventDate: null,
      spend: 0,
      proofCount: 0,
    });
  });

  (records || []).forEach((r) => {
    const id = r.system_id || null;
    if (!id || !systemMap.has(id)) return;

    const current = systemMap.get(id);

    const date = r.date || null;
    const cost = Number(r.cost || 0) || 0;

    current.spend += cost;

    if (!current.lastEventDate || (date && String(date) > String(current.lastEventDate))) {
      current.lastEventDate = date;
      current.lastEventTitle = r.title || "Service";
    }

    if (r.hasAttachment) {
      current.proofCount += 1;
    }
  });

  const enrichedSystems = Array.from(systemMap.values()).filter(
    (s) => s.lastEventTitle || s.spend > 0 || s.proofCount > 0
  );

  const timeline = (records || [])
    .map((r) => ({
      id: r.id,
      date: r.date,
      title: r.title,
      description: r.description,
      kind: r.kind,
      cost: r.cost,
      systemName: r.systemName,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    title,
    subtitle: "A documented story of care, upgrades, and ownership over time.",
    heroUri: heroUri || proofPhotos[0]?.uri || null,
    documentedSpend: totalSpend,
    systems: enrichedSystems,
    proofPhotos,
    timeline,
    context: {
      assetType: "boat",
      hin: asset?.serial_number || null,
      engineHours: asset?.engine_hours || null,
      length: asset?.length_feet || null,
    },
  };
}