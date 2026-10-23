import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({origin:"https://memoryflash.vercel.app",credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]}));
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables in server!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

/**
 * Helper: Self-Healing Profile Check
 * Ensures a profile row always exists in the public.profiles DB table.
 */
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
      meta.first_name || meta.firstName || meta.given_name || "";
    const lastName = meta.last_name || meta.lastName || meta.family_name || "";

    let fallbackFirst = firstName;
    let fallbackLast = lastName;

    if (!fallbackFirst && !fallbackLast && user.email) {
      fallbackFirst = user.email.split("@")[0];
    }

    await supabase.from("profiles").upsert(
      {
        id: userId,
        first_name: fallbackFirst || "Player",
        last_name: fallbackLast || "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }
}

/**
 * Helper: Clean Upsert for Achievements & Integer Multipliers
 */
async function upsertAchievementMultiplier(userId, baseName, tier) {
  if (tier < 1) return;
  const cleanBaseName = baseName.replace(/\s*\(\d+x\)$/i, "").trim();

  const { data: existingAch } = await supabase
    .from("user_achievements")
    .select("*")
    .eq("user_id", userId)
    .eq("achievement_name", cleanBaseName)
    .maybeSingle();

  if (existingAch) {
    if (tier > (existingAch.multiplier || 1)) {
      await supabase
        .from("user_achievements")
        .update({ multiplier: tier })
        .eq("id", existingAch.id);
    }
  } else {
    await supabase
      .from("user_achievements")
      .insert([
        { user_id: userId, achievement_name: cleanBaseName, multiplier: tier },
      ]);
  }
}

/**
 * Helper: Check Grid Guardian (3 different regions in a calendar month)
 */
async function checkGridGuardian(userId, region) {
  const currentMonthId = new Date().toISOString().slice(0, 7);

  await supabase
    .from("user_monthly_regions")
    .upsert(
      { user_id: userId, month_id: currentMonthId, region },
      { onConflict: "user_id,month_id,region" },
    );

  const { data: regionsPlayed } = await supabase
    .from("user_monthly_regions")
    .select("region")
    .eq("user_id", userId)
    .eq("month_id", currentMonthId);

  if (regionsPlayed && regionsPlayed.length >= 3) {
    const { data: stats } = await supabase
      .from("user_stats")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (stats?.last_grid_month_recorded !== currentMonthId) {
      const newSuccessMonths = (stats?.grid_guardian_success_months || 0) + 1;
      await supabase
        .from("user_stats")
        .update({
          grid_guardian_success_months: newSuccessMonths,
          last_grid_month_recorded: currentMonthId,
        })
        .eq("user_id", userId);

      if (newSuccessMonths % 3 === 0) {
        const tier = newSuccessMonths / 3;
        await upsertAchievementMultiplier(userId, "Grid Guardian", tier);
      }
    }
  }
}

/**
 * GET /api/user/profile-data
 * Returns streak, clean achievements, and explicit profile names
 */
app.get("/user/profile-data", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    const { data: achievements, error: achError } = await supabase
      .from("user_achievements")
      .select("achievement_name, multiplier, unlocked_at")
      .eq("user_id", userId);

    if (achError) throw achError;

    const { data: stats, error: statsError } = await supabase
      .from("user_stats")
      .select("current_streak")
      .eq("user_id", userId)
      .maybeSingle();

    if (statsError) throw statsError;

    return res.json({
      success: true,
      firstName: profile?.first_name || "",
      lastName: profile?.last_name || "",
      streak: stats?.current_streak || 0,
      achievements: achievements || [],
    });
  } catch (err) {
    console.error("Profile data fetch error:", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch profile stats." });
  }
});

/**
 * PUT /api/user/profile
 * Explicitly updates first and last name in profiles table & syncs leaderboard
 */
app.put("/user/profile", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  const { firstName, lastName } = req.body;

  if (!firstName && !lastName) {
    return res
      .status(400)
      .json({ error: "First name or last name is required." });
  }

  try {
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        first_name: firstName || "",
        last_name: lastName || "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (error) throw error;

    const fullName = `${firstName || ""} ${lastName || ""}`.trim();
    if (fullName) {
      await supabase
        .from("leaderboard")
        .update({ username: fullName })
        .eq("user_id", userId);
    }

    return res.json({
      success: true,
      message: "Profile updated successfully!",
    });
  } catch (err) {
    console.error("Profile update error:", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to update profile." });
  }
});

/**
 * GET /api/user/rank
 * Calculates exact leaderboard rank for user by mode and region
 */
app.get("/user/rank", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  const { mode, region } = req.query;

  if (!mode) {
    return res.status(400).json({ error: "Mode parameter is required." });
  }

  try {
    let userQuery = supabase
      .from("leaderboard")
      .select("score, region")
      .eq("user_id", userId)
      .eq("mode", mode);

    if (region && region !== "All Servers (Mixed)") {
      userQuery = userQuery.eq("region", region);
    }

    const { data: userEntry, error: userError } = await userQuery.maybeSingle();

    if (userError || !userEntry) {
      return res.json({ success: true, rank: null, score: 0 });
    }

    let countQuery = supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("mode", mode)
      .gt("score", userEntry.score);

    if (region && region !== "All Servers (Mixed)") {
      countQuery = countQuery.eq("region", region);
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    const rank = (count || 0) + 1;

    return res.json({
      success: true,
      rank,
      score: userEntry.score,
    });
  } catch (err) {
    console.error("Rank fetch error:", err.message);
    return res.status(500).json({ error: "Failed to calculate user rank." });
  }
});

/**
 * POST /api/scores
 * Submits high score using First and Last name directly from profiles DB
 */
app.post("/scores", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);

  const { mode, score, region } = req.body;

  if (!mode || typeof score !== "number" || score <= 0) {
    return res.status(400).json({ error: "Invalid score data provided." });
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    let username = "Player";
    if (profile && (profile.first_name || profile.last_name)) {
      username =
        `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
    }

    const { data: existing } = await supabase
      .from("leaderboard")
      .select("score")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();

    let isNewHigh = false;
    if (!existing || score > existing.score) {
      isNewHigh = true;
      await supabase.from("leaderboard").upsert(
        {
          user_id: userId,
          username,
          mode,
          score,
          region,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,mode" },
      );
    }

    await checkGridGuardian(userId, region || "Asia");

    return res.json({ success: true, updated: isNewHigh });
  } catch (err) {
    console.error("Score submission error:", err.message);
    return res.status(500).json({ error: "Failed to submit score to server." });
  }
});

/**
 * POST /api/stats/round-complete
 */
app.post("/stats/round-complete", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);
  const { timeTakenSeconds } = req.body;

  try {
    await supabase
      .from("user_stats")
      .upsert({ user_id: userId }, { onConflict: "user_id" });

    const { data: stats } = await supabase
      .from("user_stats")
      .select("fast_guesses_count")
      .eq("user_id", userId)
      .single();

    let fastCount = stats?.fast_guesses_count || 0;

    if (typeof timeTakenSeconds === "number" && timeTakenSeconds <= 2) {
      fastCount += 1;
      await supabase
        .from("user_stats")
        .update({ fast_guesses_count: fastCount })
        .eq("user_id", userId);

      const tier = Math.floor(fastCount / 10);
      if (tier >= 1) {
        await upsertAchievementMultiplier(userId, "Speed Demon", tier);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Round complete error:", err.message);
    return res.status(500).json({ error: "Failed to update round stats." });
  }
});

/**
 * POST /api/stats/mode-achievement
 */
app.post("/stats/mode-achievement", verifyAuth, async (req, res) => {
  const userId = req.user.id;
  await ensureUserProfile(req.user);
  const { mode, score, roundReached, seasonId } = req.body;

  try {
    await supabase
      .from("user_stats")
      .upsert({ user_id: userId }, { onConflict: "user_id" });
    const { data: stats } = await supabase
      .from("user_stats")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (
      mode === "legend" &&
      score >= 100 &&
      stats.last_quantum_season !== seasonId
    ) {
      const newCount = (stats.quantum_season_count || 0) + 1;
      await supabase
        .from("user_stats")
        .update({
          last_quantum_season: seasonId,
          quantum_season_count: newCount,
        })
        .eq("user_id", userId);
      await upsertAchievementMultiplier(userId, "Quantum Architect", newCount);
    }

    if (
      mode === "medium" &&
      roundReached >= 20 &&
      stats.last_cipher_season !== seasonId
    ) {
      const newCount = (stats.cipher_season_count || 0) + 1;
      await supabase
        .from("user_stats")
        .update({ last_cipher_season: seasonId, cipher_season_count: newCount })
        .eq("user_id", userId);
      await upsertAchievementMultiplier(userId, "Cipher Runner", newCount);
    }

    if (
      mode === "hard" &&
      score >= 50 &&
      stats.last_hardwire_season !== seasonId
    ) {
      const newCount = (stats.hardwire_season_count || 0) + 1;
      await supabase
        .from("user_stats")
        .update({
          last_hardwire_season: seasonId,
          hardwire_season_count: newCount,
        })
        .eq("user_id", userId);
      await upsertAchievementMultiplier(userId, "Hardwire Elite", newCount);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Mode achievement error:", err.message);
    return res.status(500).json({ error: "Failed to process achievement." });
  }
});

/**
 * GET /api/leaderboard
 */
app.get("/leaderboard", async (req, res) => {
  const { region, mode } = req.query;
  try {
    let query = supabase
      .from("leaderboard")
      .select("user_id, username, score, mode, region, updated_at")
      .order("score", { ascending: false });

    if (mode) query = query.eq("mode", mode);
    if (region && region !== "All Servers (Mixed)")
      query = query.eq("region", region);

    const { data, error } = await query.limit(50);
    if (error) throw error;

    return res.json({ success: true, leaderboard: data || [] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch leaderboard." });
  }
});

/**
 * GET /api/leaderboard/archives
 */
app.get("/leaderboard/archives", async (req, res) => {
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
