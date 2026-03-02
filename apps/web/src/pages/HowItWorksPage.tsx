import { useState, type ReactNode } from "react";
import {
  Layers,
  ArrowRightLeft,
  Shield,
  Coins,
  ChevronRight,
  HardDrive,
  Wifi,
  Lock,
  FileVideo,
  Upload,
  Download,
  Users,
  Zap,
  Eye,
  Server,
  CheckCircle2,
  XCircle,
  ArrowDown,
  ArrowRight,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Tab infrastructure                                                 */
/* ------------------------------------------------------------------ */

interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", icon: <Layers size={18} /> },
  { id: "transfer", label: "Data Transfer", icon: <ArrowRightLeft size={18} /> },
  { id: "seeding", label: "Why Seed?", icon: <Coins size={18} /> },
  { id: "security", label: "Security", icon: <Shield size={18} /> },
];

/* ------------------------------------------------------------------ */
/*  Shared small components                                            */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl font-bold mb-1">{children}</h2>;
}

function SectionSub({ children }: { children: ReactNode }) {
  return <p className="text-muted text-sm leading-relaxed mb-6">{children}</p>;
}

function StepCard({
  number,
  title,
  description,
  icon,
  accent = "primary",
}: {
  number: number;
  title: string;
  description: string;
  icon: ReactNode;
  accent?: "primary" | "accent" | "green" | "orange";
}) {
  const accentMap = {
    primary: { bg: "bg-primary/10", border: "border-primary/20", text: "text-primary", num: "text-primary" },
    accent: { bg: "bg-accent/10", border: "border-accent/20", text: "text-accent", num: "text-accent" },
    green: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", num: "text-emerald-400" },
    orange: { bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-400", num: "text-orange-400" },
  };
  const a = accentMap[accent];

  return (
    <div className={`relative panel flex flex-col gap-3 group hover:scale-[1.01] transition-transform duration-200`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-10 h-10 rounded-xl ${a.bg} border ${a.border} flex items-center justify-center ${a.text}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold ${a.num} tabular-nums`}>0{number}</span>
            <h3 className="font-semibold text-white text-sm">{title}</h3>
          </div>
          <p className="text-muted text-xs leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}

function DiagramBox({
  label,
  sub,
  color = "primary",
  className = "",
}: {
  label: string;
  sub?: string;
  color?: "primary" | "accent" | "green" | "orange" | "muted";
  className?: string;
}) {
  const colors = {
    primary: "border-primary/30 bg-primary/5 text-primary",
    accent: "border-accent/30 bg-accent/5 text-accent",
    green: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    orange: "border-orange-500/30 bg-orange-500/5 text-orange-400",
    muted: "border-border bg-white/[0.02] text-muted",
  };

  return (
    <div className={`rounded-xl border px-4 py-3 text-center ${colors[color]} ${className}`}>
      <div className="text-xs font-bold">{label}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function ConnectorArrow({ direction = "down", label }: { direction?: "down" | "right"; label?: string }) {
  if (direction === "right") {
    return (
      <div className="flex items-center gap-1 px-1">
        <div className="h-px w-4 bg-border" />
        <ArrowRight size={12} className="text-muted shrink-0" />
        {label && <span className="text-[9px] text-muted whitespace-nowrap">{label}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      {label && <span className="text-[9px] text-muted">{label}</span>}
      <ArrowDown size={12} className="text-muted" />
    </div>
  );
}

function InfoBadge({ children, variant = "blue" }: { children: ReactNode; variant?: "blue" | "cyan" | "green" | "orange" }) {
  const variants = {
    blue: "bg-primary/10 text-primary border-primary/20",
    cyan: "bg-accent/10 text-accent border-accent/20",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${variants[variant]}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  TAB 1: Overview                                                    */
/* ------------------------------------------------------------------ */

function OverviewTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>How Entropy Works</SectionTitle>
        <SectionSub>
          Entropy is a decentralized multimedia layer built on top of Nostr. Instead of relying on
          centralized servers to host videos and files, content is split into small pieces and
          distributed across a peer-to-peer network of browsers.
        </SectionSub>
      </div>

      {/* Architecture diagram */}
      <div className="panel p-6">
        <h3 className="text-sm font-bold text-accent mb-5 flex items-center gap-2">
          <Layers size={14} /> System Architecture
        </h3>

        <div className="flex flex-col items-center gap-2">
          {/* Browser box */}
          <div className="w-full rounded-2xl border border-border bg-white/[0.01] p-5">
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-4 text-center">
              Your Browser
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DiagramBox label="Web App" sub="Feed · Player · Upload" color="primary" />
              <DiagramBox label="@entropy/core" sub="Chunking · Crypto · P2P" color="accent" />
              <DiagramBox label="Extension" sub="Seeding · Storage · Identity" color="green" />
            </div>
          </div>

          <ConnectorArrow label="communicates with" />

          {/* External services */}
          <div className="grid grid-cols-3 gap-3 w-full">
            <DiagramBox label="Nostr Relays" sub="Metadata & Signaling" color="orange" />
            <DiagramBox label="WebRTC Peers" sub="P2P Data Transfer" color="primary" />
            <DiagramBox label="STUN/TURN" sub="NAT Traversal" color="muted" />
          </div>
        </div>
      </div>

      {/* Three pillars */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Three Core Principles</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="panel flex flex-col items-center text-center gap-3 py-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Server size={22} />
            </div>
            <div>
              <div className="font-semibold text-sm mb-1">No Central Servers</div>
              <p className="text-muted text-xs leading-relaxed">
                Content lives on users' devices, not on corporate data centers. You own your data.
              </p>
            </div>
          </div>
          <div className="panel flex flex-col items-center text-center gap-3 py-5">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Users size={22} />
            </div>
            <div>
              <div className="font-semibold text-sm mb-1">Crowd-Powered</div>
              <p className="text-muted text-xs leading-relaxed">
                Every user who watches content also helps distribute it. The more popular a file, the faster it loads.
              </p>
            </div>
          </div>
          <div className="panel flex flex-col items-center text-center gap-3 py-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Lock size={22} />
            </div>
            <div>
              <div className="font-semibold text-sm mb-1">Cryptographically Verified</div>
              <p className="text-muted text-xs leading-relaxed">
                Every piece of data is hashed with SHA-256. Tampered content is detected instantly.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick badges */}
      <div className="flex flex-wrap gap-2">
        <InfoBadge variant="blue"><Wifi size={11} /> WebRTC P2P</InfoBadge>
        <InfoBadge variant="cyan"><Lock size={11} /> SHA-256 Verified</InfoBadge>
        <InfoBadge variant="green"><HardDrive size={11} /> IndexedDB Storage</InfoBadge>
        <InfoBadge variant="orange"><Zap size={11} /> Nostr Protocol</InfoBadge>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TAB 2: Data Transfer                                               */
/* ------------------------------------------------------------------ */

function DataTransferTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>How Data Transfer Works</SectionTitle>
        <SectionSub>
          When you upload a file, it goes through a 5-stage pipeline. Files are split into chunks,
          cryptographically hashed, stored locally, and then shared across the peer-to-peer network.
        </SectionSub>
      </div>

      {/* Upload pipeline */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Upload size={14} className="text-primary" /> Upload Pipeline
        </h3>
        <div className="grid grid-cols-1 gap-3">
          <StepCard
            number={1}
            title="Chunking"
            description="Your file is split into 5 MB chunks using File.slice(). Each chunk gets its own SHA-256 hash for verification. This happens instantly in your browser — nothing leaves your device yet."
            icon={<Layers size={18} />}
            accent="primary"
          />
          <StepCard
            number={2}
            title="Merkle Hashing"
            description="All chunk hashes are combined into a Merkle tree, producing a single root hash. This root hash uniquely identifies the entire file and enables partial verification."
            icon={<Shield size={18} />}
            accent="accent"
          />
          <StepCard
            number={3}
            title="Local Storage"
            description="Each chunk is persisted in IndexedDB via the browser extension. The extension's Service Worker keeps the data alive even when you close the tab."
            icon={<HardDrive size={18} />}
            accent="green"
          />
          <StepCard
            number={4}
            title="Delegate Seeding"
            description="The extension activates relay connections, the signaling listener, and the WebRTC chunk server. Your browser is now ready to serve chunks to anyone on the network."
            icon={<Wifi size={18} />}
            accent="orange"
          />
          <StepCard
            number={5}
            title="Publish to Nostr"
            description="A kind:7001 Chunk Map event is published to Nostr relays. This event contains the root hash, ordered chunk hashes, file metadata, and a list of active seeders."
            icon={<Zap size={18} />}
            accent="primary"
          />
        </div>
      </div>

      {/* Chunk map visual */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-4 flex items-center gap-2">
          <FileVideo size={14} /> Chunk Map Event (kind:7001)
        </h3>
        <div className="bg-background/80 rounded-xl border border-border p-4 font-mono text-xs leading-relaxed overflow-x-auto">
          <div className="text-muted">{"{"}</div>
          <div className="pl-4">
            <span className="text-orange-400">"kind"</span>: <span className="text-emerald-400">7001</span>,
          </div>
          <div className="pl-4">
            <span className="text-orange-400">"content"</span>: <span className="text-primary">"My awesome video"</span>,
          </div>
          <div className="pl-4">
            <span className="text-orange-400">"tags"</span>: [
          </div>
          <div className="pl-8">
            [<span className="text-accent">"x-hash"</span>, <span className="text-muted">"a3f2...root_hash"</span>],
          </div>
          <div className="pl-8">
            [<span className="text-accent">"mime"</span>, <span className="text-muted">"video/mp4"</span>],
          </div>
          <div className="pl-8">
            [<span className="text-accent">"chunk"</span>, <span className="text-muted">"b7e1...hash_0"</span>, <span className="text-emerald-400">"0"</span>],
          </div>
          <div className="pl-8">
            [<span className="text-accent">"chunk"</span>, <span className="text-muted">"c9d4...hash_1"</span>, <span className="text-emerald-400">"1"</span>],
          </div>
          <div className="pl-8 text-muted">...</div>
          <div className="pl-4">]</div>
          <div className="text-muted">{"}"}</div>
        </div>
      </div>

      {/* Download flow */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Download size={14} className="text-accent" /> Download & Playback
        </h3>

        <div className="panel p-5">
          <div className="flex flex-col items-center gap-2">
            <DiagramBox label="Feed shows kind:7001 post" sub="User clicks play" color="primary" className="w-full max-w-sm" />
            <ConnectorArrow label="parse chunk map" />
            <DiagramBox label="Discover Seeders" sub="Find active peers via Nostr + seeder announcements" color="orange" className="w-full max-w-sm" />
            <ConnectorArrow label="WebRTC handshake" />
            <DiagramBox label="Parallel Download" sub="Request different chunks from different peers simultaneously" color="accent" className="w-full max-w-sm" />
            <ConnectorArrow label="verify SHA-256" />

            <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-center">
                <CheckCircle2 size={14} className="text-emerald-400 mx-auto mb-1" />
                <div className="text-[10px] text-emerald-400 font-bold">Valid Hash</div>
                <div className="text-[9px] text-muted">Store & play</div>
              </div>
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-center">
                <XCircle size={14} className="text-red-400 mx-auto mb-1" />
                <div className="text-[10px] text-red-400 font-bold">Invalid Hash</div>
                <div className="text-[9px] text-muted">Ban peer, retry</div>
              </div>
            </div>

            <ConnectorArrow />

            <DiagramBox
              label="MediaSource Extensions"
              sub="Stream video progressively — no need to wait for full download"
              color="green"
              className="w-full max-w-sm"
            />
          </div>
        </div>
      </div>

      {/* Binary protocol */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-3 flex items-center gap-2">
          <ArrowRightLeft size={14} /> Binary Transfer Protocol
        </h3>
        <p className="text-muted text-xs leading-relaxed mb-4">
          Chunks are exchanged over WebRTC DataChannels using a compact binary protocol.
          Large chunks (&gt;64 KB) are automatically fragmented and reassembled.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-background/60 rounded-lg border border-border p-3">
            <div className="text-[10px] font-bold text-primary mb-2">CHUNK_REQUEST (0x01)</div>
            <div className="flex gap-1 text-[9px] font-mono">
              <span className="bg-primary/15 text-primary px-1.5 py-0.5 rounded">0x01</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">chunk_hash 32B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">root_hash 32B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">pubkey</span>
            </div>
          </div>
          <div className="bg-background/60 rounded-lg border border-border p-3">
            <div className="text-[10px] font-bold text-emerald-400 mb-2">CHUNK_DATA (0x02)</div>
            <div className="flex gap-1 text-[9px] font-mono">
              <span className="bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">0x02</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">chunk_hash 32B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">data_len 4B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">data ≤64KB</span>
            </div>
          </div>
          <div className="bg-background/60 rounded-lg border border-border p-3">
            <div className="text-[10px] font-bold text-accent mb-2">CHUNK_DATA_HEADER (0x04)</div>
            <div className="flex gap-1 text-[9px] font-mono flex-wrap">
              <span className="bg-accent/15 text-accent px-1.5 py-0.5 rounded">0x04</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">chunk_hash 32B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">total_len 4B</span>
              <span className="text-muted px-1 py-0.5">+ N×64KB fragments</span>
            </div>
          </div>
          <div className="bg-background/60 rounded-lg border border-border p-3">
            <div className="text-[10px] font-bold text-red-400 mb-2">CHUNK_ERROR (0x03)</div>
            <div className="flex gap-1 text-[9px] font-mono">
              <span className="bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded">0x03</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">chunk_hash 32B</span>
              <span className="bg-white/5 text-muted px-1.5 py-0.5 rounded">reason 1B</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TAB 3: Why Seed                                                    */
/* ------------------------------------------------------------------ */

function WhySeedTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>Why You Need to Seed</SectionTitle>
        <SectionSub>
          Entropy uses a bandwidth reciprocity system. When you share content with others, you earn
          credits. When you want to download, you spend credits. This keeps the network fair and
          prevents free-riding.
        </SectionSub>
      </div>

      {/* Credit economy diagram */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-5 flex items-center gap-2">
          <Coins size={14} /> Credit Economy
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Upload = earn */}
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-emerald-500/[0.03] border border-emerald-500/10">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <Upload size={18} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <div className="font-bold text-emerald-400 text-sm">Upload = Earn</div>
              <p className="text-muted text-xs mt-1 leading-relaxed">
                When you serve a 5 MB chunk to another peer, they sign a
                cryptographic receipt (Proof of Upstream) that credits your balance with +5 MB.
              </p>
            </div>
            <div className="bg-emerald-500/10 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-400">
              balance += 5 MB
            </div>
          </div>

          {/* Download = spend */}
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-orange-500/[0.03] border border-orange-500/10">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
              <Download size={18} className="text-orange-400" />
            </div>
            <div className="text-center">
              <div className="font-bold text-orange-400 text-sm">Download = Spend</div>
              <p className="text-muted text-xs mt-1 leading-relaxed">
                When you request a chunk from the network, the seeder checks your credit balance.
                If positive, the chunk is served and your balance decreases.
              </p>
            </div>
            <div className="bg-orange-500/10 rounded-lg px-3 py-1.5 text-xs font-mono text-orange-400">
              balance -= 5 MB
            </div>
          </div>
        </div>
      </div>

      {/* Proof of Upstream */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-4 flex items-center gap-2">
          <Eye size={14} /> Proof of Upstream (kind:7772)
        </h3>
        <div className="flex flex-col items-center gap-1">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 w-full">
            <DiagramBox label="Seeder (Peer A)" sub="Sends 5 MB chunk" color="green" />
            <div className="flex flex-col items-center">
              <div className="text-[9px] text-muted mb-0.5">chunk data</div>
              <ChevronRight size={16} className="text-emerald-400" />
            </div>
            <DiagramBox label="Downloader (Peer B)" sub="Receives & verifies" color="orange" />
          </div>

          <div className="w-px h-4 bg-border" />

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 w-full">
            <div className="text-right text-[10px] text-emerald-400 font-medium">
              Validates receipt → stores in ledger → +5 MB credit
            </div>
            <div className="flex flex-col items-center">
              <ChevronRight size={16} className="text-orange-400 rotate-180" />
              <div className="text-[9px] text-muted mt-0.5">signed receipt</div>
            </div>
            <div className="text-left text-[10px] text-orange-400 font-medium">
              Signs receipt with own key → sends back via DataChannel
            </div>
          </div>
        </div>
      </div>

      {/* Benefits of seeding */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Benefits of Active Seeding</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="panel py-4 px-5">
            <div className="flex items-start gap-3">
              <Zap size={16} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">Priority Bandwidth</div>
                <p className="text-muted text-xs leading-relaxed">
                  High-credit users get served first. Your videos load faster when you have a healthy upload ratio.
                </p>
              </div>
            </div>
          </div>
          <div className="panel py-4 px-5">
            <div className="flex items-start gap-3">
              <HardDrive size={16} className="text-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">Cold Storage Custody</div>
                <p className="text-muted text-xs leading-relaxed">
                  Users with ratio ≥ 2.0 can earn premium credits by storing unpopular chunks that need preservation.
                </p>
              </div>
            </div>
          </div>
          <div className="panel py-4 px-5">
            <div className="flex items-start gap-3">
              <Users size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">Network Resilience</div>
                <p className="text-muted text-xs leading-relaxed">
                  More seeders means content stays available. If one peer goes offline, others pick up the slack automatically.
                </p>
              </div>
            </div>
          </div>
          <div className="panel py-4 px-5">
            <div className="flex items-start gap-3">
              <Shield size={16} className="text-orange-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">Censorship Resistance</div>
                <p className="text-muted text-xs leading-relaxed">
                  No single entity can take content down. As long as one seeder exists, the content remains accessible.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Credit gating callout */}
      <div className="panel p-5 border-orange-500/20 bg-orange-500/[0.02]">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
            <Lock size={16} className="text-orange-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-orange-400 mb-1">Credit Gating</h4>
            <p className="text-muted text-xs leading-relaxed">
              If your credit balance reaches zero, seeders will refuse to serve you chunks
              (error: <code className="text-orange-400 bg-orange-500/10 px-1 rounded text-[10px]">INSUFFICIENT_CREDIT</code>).
              To regain access, you need to seed content and build up your credit balance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TAB 4: Security                                                    */
/* ------------------------------------------------------------------ */

function SecurityTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>Security & Privacy</SectionTitle>
        <SectionSub>
          Entropy is designed with security at every layer. Cryptographic verification ensures data integrity,
          while the decentralized architecture provides privacy and censorship resistance.
        </SectionSub>
      </div>

      {/* Integrity verification */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-4 flex items-center gap-2">
          <Shield size={14} /> Integrity Verification — Merkle Tree
        </h3>

        <div className="flex flex-col items-center gap-3">
          {/* Chunks row */}
          <div className="grid grid-cols-4 gap-2 w-full max-w-lg">
            {["Chunk 0", "Chunk 1", "Chunk 2", "Chunk 3"].map((c, i) => (
              <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-center">
                <div className="text-[9px] text-primary font-bold">{c}</div>
                <div className="text-[8px] text-muted font-mono mt-0.5">SHA-256</div>
              </div>
            ))}
          </div>

          {/* Level 1 hashes */}
          <div className="flex items-center gap-8">
            <div className="w-px h-3 bg-border" />
            <div className="w-px h-3 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-6 w-full max-w-xs">
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-2 text-center">
              <div className="text-[9px] text-accent font-bold">Hash(0+1)</div>
            </div>
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-2 text-center">
              <div className="text-[9px] text-accent font-bold">Hash(2+3)</div>
            </div>
          </div>

          <div className="w-px h-3 bg-border" />

          {/* Root */}
          <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 px-6 py-3 text-center">
            <div className="text-xs text-emerald-400 font-bold">Merkle Root</div>
            <div className="text-[9px] text-muted mt-0.5">Published in kind:7001 ["x-hash"] tag</div>
          </div>
        </div>

        <div className="mt-4 bg-background/60 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-muted text-xs leading-relaxed">
              Each chunk is verified individually against its published hash.
              <strong className="text-white"> A single altered bit</strong> invalidates the entire verification — the peer is
              immediately flagged as malicious and banned.
            </p>
          </div>
        </div>
      </div>

      {/* Privacy layers */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Privacy Layers</h3>
        <div className="grid grid-cols-1 gap-3">
          {[
            {
              icon: <Eye size={16} />,
              title: "Plausible Deniability",
              desc: "Chunks are raw binary fragments with no recognizable format. A node never possesses a complete, identifiable file — only encrypted pieces.",
              color: "text-primary" as const,
              bg: "bg-primary/10" as const,
              border: "border-primary/20" as const,
            },
            {
              icon: <Lock size={16} />,
              title: "Encrypted Transit",
              desc: "WebRTC uses DTLS encryption by default. All P2P traffic is encrypted end-to-end. SDP signaling offers are encrypted with NIP-04/NIP-44.",
              color: "text-accent" as const,
              bg: "bg-accent/10" as const,
              border: "border-accent/20" as const,
            },
            {
              icon: <Wifi size={16} />,
              title: "Encrypted Signaling",
              desc: "WebRTC offer/answer signals are encrypted using the target peer's public key. Only the intended recipient can read the signaling data.",
              color: "text-emerald-400" as const,
              bg: "bg-emerald-500/10" as const,
              border: "border-emerald-500/20" as const,
            },
            {
              icon: <Server size={16} />,
              title: "No Central Knowledge",
              desc: "Nostr relays only see metadata events, not content. STUN/TURN servers only facilitate connection setup. Nobody sees the full picture.",
              color: "text-orange-400" as const,
              bg: "bg-orange-500/10" as const,
              border: "border-orange-500/20" as const,
            },
          ].map((item) => (
            <div key={item.title} className="panel flex items-start gap-4 py-4 px-5">
              <div className={`shrink-0 w-9 h-9 rounded-lg ${item.bg} border ${item.border} flex items-center justify-center ${item.color}`}>
                {item.icon}
              </div>
              <div>
                <div className="font-semibold text-sm mb-1">{item.title}</div>
                <p className="text-muted text-xs leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security measures */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-4 flex items-center gap-2">
          <Zap size={14} /> Active Security Measures
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "Rate Limiting", value: "10 req/s per peer", color: "text-primary" },
            { label: "Max Message Size", value: "4 MB validation", color: "text-accent" },
            { label: "Idle Timeout", value: "60s DataChannel cutoff", color: "text-emerald-400" },
            { label: "Peer Banning", value: "Auto-ban after 3 failures in 24h", color: "text-orange-400" },
            { label: "Custody Proofs", value: "Random SHA-256 challenges", color: "text-primary" },
            { label: "CSP Headers", value: "Strict Content-Security-Policy", color: "text-accent" },
          ].map((m) => (
            <div key={m.label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50 border border-border">
              <span className="text-muted text-xs">{m.label}</span>
              <span className={`text-xs font-mono font-medium ${m.color}`}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Nostr identity */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-accent mb-4 flex items-center gap-2">
          <Zap size={14} /> Identity via Nostr
        </h3>
        <p className="text-muted text-xs leading-relaxed mb-4">
          Entropy uses Nostr key pairs for identity. Your public key identifies you on the network,
          and your private key signs events and proves ownership. No email, no password, no accounts — just cryptography.
        </p>
        <div className="flex flex-col items-center gap-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 w-full">
            <DiagramBox label="NIP-07 Extension" sub="e.g. Alby, nos2x" color="orange" />
            <ConnectorArrow direction="right" label="pubkey" />
            <DiagramBox label="Entropy Web App" sub="Stores identity in Zustand" color="primary" />
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 w-full">
            <DiagramBox label="Entropy Extension" sub="Keypair in chrome.storage" color="green" />
            <ConnectorArrow direction="right" label="sign events" />
            <DiagramBox label="Nostr Relays" sub="Profile (kind:0), Feed (kind:1)" color="muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function HowItWorksPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const tabContent: Record<string, ReactNode> = {
    overview: <OverviewTab />,
    transfer: <DataTransferTab />,
    seeding: <WhySeedTab />,
    security: <SecurityTab />,
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-10">
      {/* Header */}
      <div className="flex flex-col gap-2 mb-2">
        <h1 className="text-3xl font-bold">How It Works</h1>
        <p className="text-muted">
          Learn how Entropy distributes multimedia content across a peer-to-peer network.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-border overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-primary/15 text-primary shadow-sm shadow-primary/10"
                  : "text-muted hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>{tabContent[activeTab]}</div>
    </div>
  );
}
