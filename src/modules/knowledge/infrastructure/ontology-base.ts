import { companies } from '../../clients/infrastructure/seed.ts';
import { people } from '../../workspace/infrastructure/seed.ts';
import { businessOntology } from '../domain/ontology.ts';
import { emptyOntology } from '../application/ontology-draft.ts';
import { enrichSantaClara } from './santa-clara-ontology.ts';
import { ontologies } from './seed.ts';
const businessOntologies=Object.fromEntries(companies.filter(c=>ontologies[c.slug]).map(c=>{
 const ontology=businessOntology(ontologies[c.slug],c,people);
 return[c.slug,c.slug==='santa-clara'?enrichSantaClara(ontology):ontology];
}));
/** Shared seed projection for UI and commands; new clients start with an empty map. */
export function ontologyFor(company:string){return businessOntologies[company]??emptyOntology(company);}
