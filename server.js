import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "10mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables in server!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Helper: Generate unique 5-character UUID slug for profile URLs
 */
function generateSlug(firstName, lastName) {
  const cleanFirst = (firstName || "player")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const cleanLast = (lastName || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const randomUuid5 = Math.random().toString(36).substring(2, 7);
  return `${cleanFirst}_${cleanLast}_${randomUuid5}`;
}

/**
 * Helper: Dynamic Rolling Season Date Windows
 */
function getRollingSeasonDates(type) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (type === "weekly") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    start = new Date(now.setDate(diff));
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
  } else if (type === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setMilliseconds(-1);
  } else if (type === "seasonal") {
    const month = now.getMonth();
    const seasonStartMonth = month - (month % 4);
    start = new Date(now.getFullYear(), seasonStartMonth, 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setMonth(end.getMonth() + 4);
    end.setMilliseconds(-1);
  } else {
    start = new Date(0);
    end = new Date(8640000000000000);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Middleware: Verify Supabase JWT Token
 */
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No authorization token provided." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res
        .status(401)
        .json({ error: "Invalid or expired session token." });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Authentication failed." });
  }
}

async function ensureUserProfile(user) {
  const userId = user.id;

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!existingProfile) {
    const meta = user.user_metadata || {};
    const firstName =
      meta.first_name || meta.given_name || user.email.split("@")[0];
    const lastName = meta.last_name || meta.family_name || "";
    const profileUrl = generateSlug(firstName, lastName);

    await supabase.from("profiles").upsert(
      {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email: user.email,
        profile_url: profileUrl,
        avatar_url: meta.avatar_url || "https://i.pravatar.cc/150?img=33",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }
}

// ==========================================
// USER & PROFILE ENDPOINTS
// ==========================================

app.get("/api/user/profile-data", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, profile_url, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    const { data: achievements } = await supabase
      .from("user_achievements")
      .select("achievement_name, multiplier, unlocked_at")
      .eq("user_id", userId);

    const { data: stats } = await supabase
      .from("user_stats")
      .select("current_streak")
      .eq("user_id", userId)
      .maybeSingle();

    return res.json({
      success: true,
      firstName: profile?.first_name || "",
      lastName: profile?.last_name || "",
      profileUrl: profile?.profile_url || "",
      streak: stats?.current_streak || 0,
      achievements: achievements || [],
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch profile stats." });
  }
});

/**
 * GET /api/user/profile -> Fetch logged-in user's private profile
 */
app.get("/api/user/profile", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      return res
        .status(404)
        .json({ success: false, error: "Profile not found." });
    }

    const fullName =
      `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
      req.user.email.split("@")[0];

    return res.json({
      success: true,
      user: {
        id: profile.id,
        name: fullName,
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        email: profile.email || req.user.email,
        avatar: profile.avatar_url || "https://i.pravatar.cc/150?img=33",
        profileUrl: profile.profile_url,
        streak: profile.streak || 0,
        rank: profile.rank || "UNRANKED",
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch profile." });
  }
});

/**
 * PUT /api/user/profile -> Update logged-in user's name & generate persistent URL slug
 */
app.put("/api/user/profile", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  const { firstName, lastName } = req.body;

  try {
    const profileUrl = generateSlug(firstName, lastName);

    const { data, error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName || "",
        last_name: lastName || "",
        profile_url: profileUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const fullName = `${data.first_name || ""} ${data.last_name || ""}`.trim();

    return res.json({
      success: true,
      profile: {
        id: data.id,
        name: fullName,
        firstName: data.first_name,
        lastName: data.last_name,
        profileUrl: data.profile_url,
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: "Failed to update profile details." });
  }
});

/**
 * GET /api/user/public/:slug -> Fetch public profile by URL slug (No auth required)
 */
app.get("/api/user/public/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("profile_url", slug)
      .single();

    if (error || !profile) {
      return res
        .status(404)
        .json({ success: false, error: "Public profile not found." });
    }

    const fullName =
      `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
      "Player";

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        email: profile.email,
        name: fullName,
        avatar: profile.avatar_url || "https://i.pravatar.cc/150?img=33",
        profileUrl: profile.profile_url,
        streak: profile.streak || 0,
        rank: profile.rank || "UNRANKED",
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch public profile." });
  }
});

/**
 * POST /api/user/avatar -> Update profile picture avatar
 */
app.post("/api/user/avatar", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  const { avatar } = req.body;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ avatar_url: avatar, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, avatar: data.avatar_url });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/user/rank
 */
app.get("/api/user/rank", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  const { mode, region } = req.query;

  if (!mode)
    return res.status(400).json({ error: "Mode parameter is required." });

  try {
    let query = supabase
      .from("leaderboard")
      .select("score")
      .eq("user_id", userId)
      .eq("mode", mode);

    if (region && region !== "All Servers (Mixed)") {
      query = query.eq("region", region);
    }

    const { data: userEntry } = await query.maybeSingle();
    if (!userEntry) return res.json({ success: true, rank: null, score: 0 });

    let countQuery = supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("mode", mode)
      .gt("score", userEntry.score);

    if (region && region !== "All Servers (Mixed)") {
      countQuery = countQuery.eq("region", region);
    }

    const { count } = await countQuery;
    const rank = (count || 0) + 1;
    const userRankPercent = Math.min(100, Math.round((rank / 100) * 100));

    return res.json({
      success: true,
      rank,
      score: userEntry.score,
      userRank: userRankPercent,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to calculate user rank." });
  }
});

// ==========================================
// SCORES & LEADERBOARD ENDPOINTS
// ==========================================

/**
 * POST /api/scores/sync-local
 */
app.post("/api/scores/sync-local", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);
  const { localScores } = req.body;

  if (!localScores || typeof localScores !== "object") {
    return res.status(400).json({ error: "Invalid local scores object." });
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    const username =
      `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
      "Player";
    let syncedCount = 0;

    for (const [mode, score] of Object.entries(localScores)) {
      const numericScore = Number(score);
      if (isNaN(numericScore) || numericScore <= 0) continue;

      const { data: existing } = await supabase
        .from("leaderboard")
        .select("score")
        .eq("user_id", userId)
        .eq("mode", mode)
        .maybeSingle();

      if (!existing || numericScore >= existing.score) {
        syncedCount++;
        const seasonDates = getRollingSeasonDates("monthly");

        await supabase.from("leaderboard").upsert(
          {
            user_id: userId,
            username,
            mode,
            score: numericScore,
            region: "Asia",
            season_started_at: seasonDates.start,
            season_ends_at: seasonDates.end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,mode" },
        );
      }
    }

    return res.json({ success: true, syncedCount });
  } catch (err) {
    return res.status(500).json({ error: "Failed to sync local scores." });
  }
});

/**
 * POST /api/scores
 */
app.post("/api/scores", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);

  const { mode, score, region } = req.body;
  const numericScore = Number(score);

  if (!mode || isNaN(numericScore) || numericScore <= 0) {
    return res.status(400).json({ error: "Invalid score data provided." });
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    const username =
      `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
      "Player";

    const { data: existing } = await supabase
      .from("leaderboard")
      .select("score")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();

    let isNewHigh = false;
    if (!existing || numericScore >= existing.score) {
      isNewHigh = true;
      const seasonDates = getRollingSeasonDates("monthly");

      const { error: upsertError } = await supabase.from("leaderboard").upsert(
        {
          user_id: userId,
          username,
          mode,
          score: numericScore,
          region: region || "Asia",
          season_started_at: seasonDates.start,
          season_ends_at: seasonDates.end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,mode" },
      );

      if (upsertError) throw upsertError;
    }

    let countQuery = supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("mode", mode)
      .gt("score", numericScore);

    const { count } = await countQuery;
    const rank = (count || 0) + 1;
    const percentile = Math.min(100, Math.round((rank / 100) * 100));

    return res.json({
      success: true,
      updated: isNewHigh,
      isNewLeaderboardHigh: isNewHigh,
      rank,
      percentile,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to submit score to server." });
  }
});

/**
 * GET /api/leaderboard
 */
app.get("/api/leaderboard", async (req, res) => {
  const { region, mode, limit, type } = req.query;
  try {
    let query = supabase
      .from("leaderboard")
      .select(
        `
        user_id,
        username,
        score,
        mode,
        region,
        season_started_at,
        season_ends_at,
        updated_at,
        profiles (
          avatar_url,
          profile_url,
          streak_seasons
        )
      `,
      )
      .order("score", { ascending: false });

    if (mode) query = query.eq("mode", mode);
    if (region && region !== "All Servers (Mixed)") {
      query = query.eq("region", region);
    }

    const activeType = type || "all";
    const seasonDates = getRollingSeasonDates(activeType);

    if (activeType !== "all") {
      query = query
        .gte("updated_at", seasonDates.start)
        .lte("updated_at", seasonDates.end);
    }

    const maxLimit = Number(limit) || 100;
    const { data, error } = await query.limit(maxLimit);
    if (error) throw error;

    const formattedLeaderboard = (data || []).map((row) => ({
      userId: row.user_id,
      username: row.username,
      score: row.score,
      mode: row.mode,
      region: row.region,
      avatar: row.profiles?.avatar_url || "https://i.pravatar.cc/150?img=33",
      profileUrl: row.profiles?.profile_url || "",
      streak: row.profiles?.streak_seasons || 0,
    }));

    const seasonStartedAt = activeType === "all" ? null : seasonDates.start;
    const seasonEndsAt = activeType === "all" ? null : seasonDates.end;

    return res.json({
      success: true,
      leaderboard: formattedLeaderboard,
      seasonStartedAt,
      seasonEndsAt,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch leaderboard." });
  }
});

/**
 * GET /api/leaderboard/archives
 */
app.get("/api/leaderboard/archives", async (req, res) => {
  const { season_type, mode } = req.query;
  try {
    let query = supabase
      .from("leaderboard_archives")
      .select("*")
      .order("archived_at", { ascending: false });

    if (season_type) query = query.eq("season_type", season_type);
    if (mode) query = query.eq("mode", mode);

    const { data, error } = await query.limit(50);
    if (error) throw error;

    return res.json({ success: true, archives: data || [] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch archives." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Secure backend server running on port ${PORT}`),
);

export default app;
