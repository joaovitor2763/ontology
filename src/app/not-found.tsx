import { NotFoundState } from "@g4ai/ds";
import { Button, Page } from "@/shared/ui/primitives";
import { paths } from "@/shared/lib/routes";

export default function NotFound() {
  return (
    <Page>
      <NotFoundState
        size="page"
        title="Vamos retomar o caminho?"
        description="Este endereço não está disponível. Volte ao seu workspace ou encontre o cliente que procura."
        action={
          <Button href="/" size="sm">
            Visão geral
          </Button>
        }
        secondaryAction={
          <Button href={paths.clients} variant="ghost" size="sm">
            Ver clientes
          </Button>
        }
      />
    </Page>
  );
}
