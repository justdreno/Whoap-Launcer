# 💎 Whoap Launcher

**Whoap** is a state-of-the-art, modern Minecraft launcher built with Electron and React. It features a minimal, iOS-inspired design with a focus on ease of use, cloud integration, and advanced content management.

---

## ✨ Key Features

### 🚀 Advanced Instance Management
- **Multi-Loader Support**: Native support for Vanilla, Forge, Fabric, Quilt, and NeoForge loaders.
- **Smart Inheritance**: Robust resolution of version dependencies and loaders to prevent crashes.
- **Instance Wizards**: Easy-to-use "Create Instance" workflows with automatic assets and loader downloads.
- **Import/Export**: Support for `.zip` and `.mrpack` (Modrinth) formats with a fast, parallelized installation process.

### 🍱 Unified Content Hub (Mods, Resource Packs, Shaders)
- **Modrinth Integration**: One-click installation of mods, resource packs, and shaderpacks directly from Modrinth.
- **Smart Detection**: Automatic detection of Minecraft version and loader compatibility, with validation warnings for snapshots or unsupported loaders.
- **Featured Content**: Discover popular mods (like JEI and Sodium) directly within the launcher.
- **Enable/Disable**: Toggle individual mods or packs on the fly without deleting files.

### ☁️ Cloud & Social Integration
- **Cloud Sync (Supabase)**: Synchronize your instances, settings, and accounts across multiple devices.
- **Whoap Accounts**: Custom authentication system with shared profile metadata and cloud-backed favorites.
- **Friends System**: BETA friends system for shared instance viewing and community interaction.
- **3D Skin Viewer**: Premium real-time 3D skin and cape visualization on the dashboard and profile pages.
---

## 🏗️ Architecture

The project follows a modular Electron + React structure:

- **`electron/`**: Main process logic, IPC handlers, and system managers.
  - **`managers/`**: Individual services for Auth, Mods, Cloud, Config, Network, and Instances.
  - **`api/`**: Integrations with external services like Modrinth and Mojang.
  - **`launcher/`**: core logic for launching the Minecraft process via `minecraft-launcher-core`.
- **`src/`**: React frontend with a focus on UI/UX excellence.
  - **`pages/`**: Feature-complete screens (Home, Instances, Admin, Settings, etc.).
  - **`context/`**: State management for Toasts, Confirmations, and Auth.
  - **`components/`**: Reusable UI primitives (Glass cards, Modals, Buttons).

---

## 💻 Tech Stack

- **Core**: [Electron](https://www.electronjs.org/), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Styling**: Vanilla CSS with CSS Modules (iOS-inspired Design System)
- **Database/Auth**: [Supabase](https://supabase.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Game Logic**: [minecraft-launcher-core](https://www.npmjs.com/package/minecraft-launcher-core)

---

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Development
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server (concurrently runs React + Electron):
   ```bash
   npm run dev
   ```

### Building
To build a production executable for Windows:
```bash
npm run build
```

---

## 📜 Roadmap

For the detailed development timeline and upcoming features, please refer to [ROADMAP.md](file:///d:/Whoap/ROADMAP.md).

---

*Built with ❤️ by the Whoap Team.*
