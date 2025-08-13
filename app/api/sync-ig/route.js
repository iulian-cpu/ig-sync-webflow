export const runtime = "edge";

const IG_USER_ID = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_LONG_LIVED_TOKEN;
const WF_TOKEN = process.env.WEBFLOW_TOKEN;
const COLLECTION = process.env.WEBFLOW_COLLECTION_ID;

// Schimbă valorile din dreapta cu "Field API name" exacte din colecția ta Webflow
const FIELDS = {
  name: "name",
  image: "instagramImage",            // Image
  caption: "instagramDescription",    // Plain text
  permalink: "instagramLink",         // Link
  mediaType: "mediaType",             // Option: IMAGE/VIDEO/CAROUSEL
  videoUrl: "videoUrl",               // Plain text
  igMediaId: "igMediaId",             // Plain text
  postedAt: "postedAt"                // Date/Time
};

const IG_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}";

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchIG(limit = 24) {
  const u = new URL(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media`);
  u.searchParams.set("fields", IG_FIELDS);
  u.searchParams.set("access_token", IG_TOKEN);
  u.searchParams.set("limit", String(limit));
  const data = await fetchJSON(u.toString());
  return data.data || [];
}

function normalizeCarousel(m) {
  if (m.media_type !== "CAROUSEL_ALBUM") return m;
  const first = m.children?.data?.[0];
  if (!first) return m;
  return {
    ...m,
    media_type: first.media_type,
    media_url: first.media_url,
    thumbnail_url: first.thumbnail_url || m.thumbnail_url
  };
}

async function wfListItems(offset = 0) {
  const url = `https://api.webflow.com/v2/collections/${COLLECTION}/items?limit=100&offset=${offset}`;
  return fetchJSON(url, { headers: { Authorization: `Bearer ${WF_TOKEN}` } });
}

async function wfExistingIGIDs() {
  const set = new Set();
  let offset = 0;
  while (true) {
    const data = await wfListItems(offset);
    (data.items || []).forEach((it) => {
      const fd = it.fieldData || {};
      const igid = fd[FIELDS.igMediaId] || fd["ig-media-id"];
      if (igid) set.add(String(igid));
    });
    if (!data.items || data.items.length < 100) break;
    offset += 100;
  }
  return set;
}

async function wfCreateItem(fieldData) {
  const url = `https://api.webflow.com/v2/collections/${COLLECTION}/items/live`;
  const body = JSON.stringify({ isArchived: false, isDraft: false, fieldData });
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function GET() {
  try {
    ["IG_USER_ID","IG_LONG_LIVED_TOKEN","WEBFLOW_TOKEN","WEBFLOW_COLLECTION_ID"].forEach((k)=>{
      if(!process.env[k]) throw new Error(`Missing ENV: ${k}`);
    });

    const [igMedia, existing] = await Promise.all([fetchIG(24), wfExistingIGIDs()]);
    let created = 0;

    for (const raw of igMedia) {
      const m = normalizeCarousel(raw);
      if (existing.has(String(m.id))) continue;

      const isVideo = m.media_type === "VIDEO";
      const name = `${new Date(m.timestamp).toISOString().slice(0,10)} — ${m.id}`;
      const imageUrl = isVideo ? (m.thumbnail_url || "") : (m.media_url || "");

      const fieldData = {
        [FIELDS.name]: name,
        [FIELDS.caption]: m.caption || "",
        [FIELDS.permalink]: m.permalink,
        [FIELDS.mediaType]: m.media_type,        // IMAGE / VIDEO / CAROUSEL_ALBUM
        [FIELDS.videoUrl]: isVideo ? m.media_url : "",
        [FIELDS.igMediaId]: m.id,
        [FIELDS.postedAt]: m.timestamp,
        [FIELDS.image]: imageUrl                 // dacă dă 400, schimbă în: {[FIELDS.image]: { url: imageUrl }}
      };

      await wfCreateItem(fieldData);
      created++;
    }

    return new Response(JSON.stringify({ ok: true, created }), { status: 200, headers: { "Content-Type": "application/json" }});
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" }});
  }
}
