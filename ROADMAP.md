# Whoap Launcher - Development Roadmap

## ✅ Phase 1: Core Foundation (Complete)
- [x] Electron + React + TypeScript setup
- [x] Microsoft Authentication (MSMC)
- [x] Offline Account Support
- [x] Whoap Cloud Authentication (Supabase)
- [x] Instance/Profile Management
- [x] Version Discovery (Mojang API + Local)
- [x] Game Launching with Asset Verification
- [x] Java Runtime Management (Auto-download)
- [x] TLauncher Version Compatibility

---

## ✅ Phase 2: UX Polish (Complete)
- [x] Custom Frameless Window with Title Bar
- [x] Modern Dark Theme with Orange Accents
- [x] Splash Screen with Loading Animation
- [x] Profile Favorites System (⭐ with cloud sync)
- [x] Profile Type Icons (Globe for imported, Rocket for created)
- [x] Java Download Progress UI
- [x] Frameless Game Output Log Window
- [x] System Tray Integration (minimize on launch)
- [x] TLauncher "Version Isolation" Support (mods/configs in version folder)
- [x] **Redesigned Login Page** (Split-panel layout, login_bg.png)
- [x] **Redesigned Home Dashboard** (Hero section, skin preview, launch progress)
- [x] **Redesigned Loading Screen** (Glassmorphism card, shimmer progress)
- [x] **Redesigned Modpack Browser** (Clean cards, image hover effects)

---

## ✅ Phase 3: Settings & Configuration (Complete)
- [x] Settings Page UI
  - [x] Game Directory selector
  - [x] RAM Allocation slider (min/max)
  - [x] Per-Version Java Path override (8, 11, 16, 17, 21)
  - [x] Launch behavior (hide/minimize/keep open)
  - [x] Show Console toggle
- [ ] Per-Instance Settings (deferred to Phase 5)

---

## ✅ Phase 4: Modpack & Mod Support (Complete)
- [x] Modrinth API Integration
  - [x] Browse modpacks
  - [x] Install modpacks
  - [x] Mod search and install
- [x] Mod Manager UI
  - [x] View installed mods per instance
  - [x] Enable/Disable mods
- [x] Dedicated News & Updates Page
- [x] Interactive Dashboard with Skin Preview

---

## ✅ Phase 5: Instance Management (Complete)
- [x] Create Instance Wizard
  - [x] Select Minecraft version
  - [x] Select loader (Vanilla, Forge, Fabric, Quilt, NeoForge)
  - [x] Auto-download loader
  - [x] Robust Inheritance Resolution (Fixes "Game provider" crash)
- [x] Edit Instance (Basic metadata)
- [x] Delete Instance (with local/cloud sync)
- [x] Duplicate Instance
- [x] Export/Import Instance (as `.zip` or `.mrpack`)

---

## ☁️ Phase 6: Cloud Features
- [x] Cloud Sync for Settings
- [x] Cloud Sync for Instances (metadata only)
- [x] Friends List (Whoap accounts) **(BETA)**
- [x] Shared Instance System (BETA)

---

## 🎨 Phase 7: Cosmetics & Social
- [x] Dynamic Skin Fetching (Dashboard)
- [x] Skin Viewer (3D Steve/Alex preview)
- [x] Skin Upload (for Whoap accounts)
- [x] Cape Support
- [x] Playtime Tracking
- [x] Achievement Badges

---

## ✅ Phase 8: Admin & Community System
- [x] Database Schema Updates (Badges, News, Roles)
- [x] Admin Dashboard Page (Only visible to admins with role-based access control)
- [x] Badge Management (Create, Grant, Revoke)
- [x] News/Changelog Management
- [x] User Management (Ban/Unban, Role Edit)
- [x] Dynamic Role/Badge Fetching (removed hardcoded UUIDs)
- [x] Fixed Signup Data Saving (creates profiles table entry)
- [x] Fixed Account Switching Session Sync

---

## 🔒 Phase 9: Security & Performance
- [x] Code Signing for Windows/Mac builds
- [x] Auto-Updater (electron-updater)
- [x] Smart Crash Handler (Auto-analysis & suggestions)
- [x] Performance Profiling
- [x] Startup Optimization (Lazy Loading)

---

## 💡 Future Ideas (Backlog)
- [ ] Server browser / Quick Connect
- [ ] Resource Pack manager
- [ ] Shader Pack manager
- [ ] World backup & restore
- [ ] Multi-account quick switcher
- [ ] Discord Rich Presence
- [ ] Twitch/YouTube streaming integration
- [ ] Controller support configuration
- [ ] Localization (i18n) support
- [ ] Linux support

---

## 📊 Current Status

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1 | ✅ Complete | 100% |
| Phase 2 | ✅ Complete | 100% |
| Phase 3 | ✅ Complete | 100% |
| Phase 4 | ✅ Complete | 100% |
| Phase 5 | ✅ Complete | 100% |
| Phase 6 | 🚧 In Progress | 75% |
| Phase 7 | ✅ Complete | 100% |
| Phase 8 | ✅ Complete | 100% |
| Phase 9 | ✅ Complete | 100% |

---

*Last Updated: January 14, 2026*
