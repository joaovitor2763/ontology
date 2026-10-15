import { AppShell } from "@/modules/workspace/presentation/AppShell";
import { DsSetup } from "@/shared/ui/DsSetup";
import { themeScript } from "@g4ai/ds/lib/theme";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Figtree } from "next/font/google";
import "./globals.css";
import { refreshNow } from "@/shared/lib/format";
import { BOOTSTRAP_TABLE } from "@/shared/infrastructure/bootstrap-keys";
import { earlyBootScript } from "@/shared/infrastructure/early-boot";

/** Dispara o bootstrap e os dados da tela enquanto o HTML é lido (`early-boot.ts`). */
const earlyBoot = earlyBootScript(BOOTSTRAP_TABLE);

const sans = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

/** Every screen depends on the current date and the signed-in person; render per request. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ontology · Gestão de serviços",
  description:
    "Ontology: clientes, planos, ciclos, entregas, reuniões, interações e ontologia.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  refreshNow();
  return (
    <html
      lang="pt-BR"
      className={`ds-app ${sans.variable}`}
      data-theme="system"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* g4os-ds-disable-next-line dangerous-html -- script gerado no próprio código (early-boot.ts), sem entrada de usuário */}
        <script dangerouslySetInnerHTML={{ __html: earlyBoot }} />
      </head>
      <body>
        <DsSetup />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
