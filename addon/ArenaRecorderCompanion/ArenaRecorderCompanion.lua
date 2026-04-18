-- ArenaRecorderCompanion
-- 1. Writes your character's GUID, name, realm, class and spec to SavedVariables
--    so the Arena Recorder desktop app can identify your team in combat logs.
-- 2. Automatically enables combat logging when you enter an arena so the desktop
--    app always has a log to analyse — even if you forgot to enable it manually.
--
-- SavedVariables file location:
--   WTF/Account/<AccountName>/SavedVariables/ArenaRecorderCompanion.lua
--
-- The desktop app reads this file on startup and after each arena match.

ArenaRecorderDB = ArenaRecorderDB or {}

-- ---------------------------------------------------------------------------
-- Character info
-- ---------------------------------------------------------------------------

local function SaveCharacterInfo()
    local name = UnitName("player")
    if not name then return end

    local realm = GetNormalizedRealmName() or GetRealmName() or ""
    local _, className = UnitClass("player")
    local guid = UnitGUID("player") or ""

    local specIndex = GetSpecialization()
    local specName = ""
    if specIndex then
        local _, sn = GetSpecializationInfo(specIndex)
        specName = sn or ""
    end

    ArenaRecorderDB.character = {
        guid      = guid,
        name      = name,
        realm     = realm,
        fullName  = name .. "-" .. realm,
        class     = className or "",
        spec      = specName,
        updated   = date("%Y-%m-%dT%H:%M:%S"),
    }
end

-- ---------------------------------------------------------------------------
-- Combat logging
-- ---------------------------------------------------------------------------

-- Ensures combat logging is active. Called every time the player enters an arena
-- so recordings start from the very first event of the match.
local function EnsureCombatLogging()
    if not LoggingCombat() then
        LoggingCombat(true)
        print("|cff00ff00[Arena Recorder]|r Combat logging enabled.")
    end
end

-- Returns true when the player is inside an arena instance.
local function IsInArena()
    local _, instanceType = IsInInstance()
    return instanceType == "arena"
end

-- ---------------------------------------------------------------------------
-- Slash command: /arenarecorder  or  /arc
-- ---------------------------------------------------------------------------

local PREFIX = "|cff00aaffArena Recorder Companion|r"

local function PrintAbout()
    print(" ")
    print(PREFIX .. " v1.1.0")
    print("|cffaaaaaa----------------------------------------|r")
    print("This addon is a companion for the |cff00aaff Arena Recorder|r desktop app.")
    print("It does |cffff4444two|r small things:")
    print("  |cffffff00 1.|r Saves your character GUID, name, class and spec to")
    print("     SavedVariables so the app can identify |cff00ff00your team|r in arena logs.")
    print("  |cffffff00 2.|r Automatically turns on combat logging when you enter")
    print("     an arena, so no matches are ever missed.")
    print("|cffaaaaaa----------------------------------------|r")
    print("|cff00ff00What it does NOT do:|r")
    print("  - Does not read game memory")
    print("  - Does not intercept or modify network packets")
    print("  - Does not change any gameplay behaviour")
    print("  - Only writes data you already see (name, class, spec) to a local file")
    print("|cffaaaaaa----------------------------------------|r")
    print("Type |cffffff00/arc|r or |cffffff00/arenarecorder|r to see this again.")
    print(" ")
end

SLASH_ARENARECORDER1 = "/arenarecorder"
SLASH_ARENARECORDER2 = "/arc"
SlashCmdList["ARENARECORDER"] = PrintAbout

-- ---------------------------------------------------------------------------
-- Event handling
-- ---------------------------------------------------------------------------

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ACTIVE_TALENT_GROUP_CHANGED")

frame:SetScript("OnEvent", function(_, event)
    -- Print a one-line status on first login so users see the addon is active.
    if event == "PLAYER_LOGIN" then
        print(PREFIX .. " loaded. Type |cffffff00/arc|r for info.")
    end

    -- Small delay so UnitGUID / spec APIs return fresh values after zone change.
    C_Timer.After(1, function()
        SaveCharacterInfo()

        -- If we just entered an arena, make sure the combat log is running.
        -- This is the primary trigger that lets the desktop app capture the full match.
        if event == "PLAYER_ENTERING_WORLD" and IsInArena() then
            EnsureCombatLogging()
        end
    end)
end)
