import type { Company } from '../../modules/clients/domain/models.ts';
import { slugify } from '../../modules/clients/domain/models.ts';
import { validClientLogo } from '../../modules/clients/domain/identity.ts';
import { defaultService, type ServiceConfig } from '../../modules/clients/domain/service-config.ts';
import { initialsOf } from '../../modules/workspace/domain/models.ts';
import { stakeholderRoles, stakeholderStances, influenceLevels, type Stakeholder } from '../../modules/clients/domain/stakeholders.ts';
import { validBoundedDate, validDate } from '../../modules/delivery/application/plan-execution.ts';
import * as v from './input.ts';
import { contactInput } from './contact-input.ts';
export function clientInput(value: unknown, previous: Company | undefined, author: string, at: string): Company {
  const raw = v.object(value);
  const name = v.string(raw.name, 'nome', previous?.name, 300);
  if (!name) v.invalid('Informe o nome do cliente.');
  const slug = v.string(raw.slug, 'identificador', previous?.slug ?? slugify(name), 48);
  if (!slug || slugify(slug) !== slug || (previous && slug !== previous.slug)) v.invalid('O identificador do cliente é inválido ou foi alterado.');
  const text = (key: keyof Company, fallback = '') => v.string(raw[key], key, typeof previous?.[key] === 'string' ? previous[key] as string : fallback);
  const startedAt = text('startedAt');
  if (!validDate(startedAt) || (startedAt !== previous?.startedAt && !validBoundedDate(startedAt))) v.invalid('Informe uma data de início válida, entre 2000 e 2100.');
  const initials = text('initials');
  if (initials && Array.from(initials).length !== 2) v.invalid('Use dois caracteres nas iniciais.');
  const logo = v.string(raw.logo, 'logo', previous?.logo ?? '', 32000);
  if (logo && !validClientLogo(logo)) v.invalid('Use uma miniatura WebP válida.');
  const charter = raw.charter === undefined ? previous?.charter : v.object(raw.charter);
  let normalizedCharter: Company['charter'];
  if (charter) {
    const constraints = charter.constraints ? v.object(charter.constraints) : {};
    normalizedCharter = {objective:v.string(charter.objective,'objetivo',''),clarifiedObjective:v.string(charter.clarifiedObjective,'objetivo esclarecido',''),finishedLooksLike:v.string(charter.finishedLooksLike,'resultado',''),keyQuestion:v.string(charter.keyQuestion,'pergunta',''),constraints:{time:v.string(constraints.time,'tempo',''),capital:v.string(constraints.capital,'capital',''),talent:v.string(constraints.talent,'pessoas','')}};
  }
  return {
    slug,name,initials,logo,legalName:text('legalName',name),sector:text('sector'),city:text('city'),uf:text('uf'),
    status:v.choice(raw.status,['ativo','pausado','encerrado'] as const,previous?.status ?? 'ativo'),
    milestone:v.number(raw.milestone,previous?.milestone ?? 1,1),health:v.number(raw.health,previous?.health ?? 80,0,100),
    healthFlag:v.choice(raw.healthFlag,['green','yellow','red'],previous?.healthFlag ?? 'green'),coverage:v.number(raw.coverage,previous?.coverage ?? 0,0,100),
    sponsorId:previous?.sponsorId ?? '',leadId:text('leadId'),csId:text('csId'),startedAt,contract:text('contract'),
    nextMilestone:text('nextMilestone'),nextMilestoneAt:text('nextMilestoneAt'),summary:text('summary'),tint:text('tint','#1F5C57'),journeyId:text('journeyId','service-delivery'),
    charter:normalizedCharter,createdBy:previous?.createdBy ?? author,createdAt:previous?.createdAt ?? at,updatedAt:at,
  };
}
export function serviceInput(value: unknown, fallback: ServiceConfig = defaultService): ServiceConfig {
  const raw = v.object(value);
  const modules = raw.modules === undefined ? fallback.modules : v.object(raw.modules);
  const whatsapp = raw.whatsapp === undefined ? fallback.whatsapp : v.object(raw.whatsapp);
  return {name:v.string(raw.name,'escopo',fallback.name),model:v.choice(raw.model,['consultoria','implementacao','recorrente'],fallback.model),cadenceWeeks:v.number(raw.cadenceWeeks,fallback.cadenceWeeks,1,52),
    productIds:raw.productIds === undefined ? fallback.productIds ?? [] : v.strings(raw.productIds,'produtos'),
    modules:{ontology:v.boolean(modules.ontology,false)},
    ...(whatsapp ? {whatsapp:{groupName:v.string(whatsapp.groupName,'grupo',''),groupId:v.string(whatsapp.groupId,'grupo','')}} : {}),
  };
}
export function stakeholderInput(value: unknown, company: string, previous?: Stakeholder): Stakeholder {
  const raw=v.object(value), name=v.string(raw.name,'nome',previous?.name,300);
  const text=(key:keyof Stakeholder)=>v.string(raw[key],key,typeof previous?.[key]==='string' ? previous[key] as string : '');
  return {id:previous?.id ?? (raw.id ? v.id(raw.id) : crypto.randomUUID()),company,org:'client',name,initials:initialsOf(name),role:text('role'),area:text('area'),...contactInput(raw,previous),notes:text('notes'),
    accountRole:v.choice(raw.accountRole,Object.keys(stakeholderRoles) as Stakeholder['accountRole'][],previous?.accountRole ?? 'outro'),
    active:v.boolean(raw.active,previous?.active ?? true),primary:v.boolean(raw.primary,previous?.primary ?? false),
    stance:v.choice(raw.stance,Object.keys(stakeholderStances) as NonNullable<Stakeholder['stance']>[],previous?.stance ?? 'desconhecido'),
    influence:v.choice(raw.influence,Object.keys(influenceLevels) as NonNullable<Stakeholder['influence']>[],previous?.influence ?? 'media'),communicationPreference:text('communicationPreference'),helpOffered:text('helpOffered'),
  };
}
