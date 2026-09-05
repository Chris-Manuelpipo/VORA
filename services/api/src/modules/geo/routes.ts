// VORA — routes du module geo.
//
//   GET  /v1/geo/search?q=&lat=&lng=   recherche par repères, tolérante aux fautes
//   GET  /v1/geo/zones                 zones actives, en GeoJSON, pour la carte
//   GET  /v1/geo/route                 itinéraire OSRM, avec repli haversine visible
//   POST /v1/geo/moto/check            cette course est-elle possible en moto ?
//
// Ces quatre routes sont PUBLIQUES : on cherche un repère et on regarde les zones
// interdites avant de se connecter. Elles ne renvoient aucune donnée personnelle.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  landmarkSearchQuerySchema,
  landmarkSearchResponseSchema,
  motoCheckBodySchema,
  motoCheckResponseSchema,
  routeQuerySchema,
  routeResponseSchema,
  zonesQuerySchema,
  zonesResponseSchema,
} from './schemas.js';
import * as service from './service.js';

export const geoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/geo/search',
    {
      schema: {
        tags: ['geo'],
        summary: 'Chercher un repère de Yaoundé',
        querystring: landmarkSearchQuerySchema,
        response: { 200: landmarkSearchResponseSchema },
      },
    },
    async (request) => service.searchLandmarks(request.query),
  );

  app.get(
    '/geo/zones',
    {
      schema: {
        tags: ['geo'],
        summary: 'Zones réglementaires actives, en GeoJSON',
        querystring: zonesQuerySchema,
        response: { 200: zonesResponseSchema },
      },
    },
    async (request) => service.listZones(request.query.kind),
  );

  app.get(
    '/geo/route',
    {
      schema: {
        tags: ['geo'],
        summary: 'Itinéraire entre deux points (OSRM, repli haversine)',
        querystring: routeQuerySchema,
        response: { 200: routeResponseSchema },
      },
    },
    async (request) => {
      const { from_lat, from_lng, to_lat, to_lng } = request.query;
      const result = await service.computeRoute(
        { lat: from_lat, lng: from_lng },
        { lat: to_lat, lng: to_lng },
      );

      // Le repli est normal et prévu, mais il n'est jamais silencieux : on veut pouvoir
      // dire au jury POURQUOI la démo est passée en mode dégradé, pas seulement qu'elle
      // l'a fait. Le passager, lui, ne lit pas nos pannes — la raison reste dans le log.
      if (result.routing === 'fallback') {
        request.log.warn({ reason: result.fallbackReason }, 'Routage en repli haversine');
      }

      return {
        distanceM: result.distanceM,
        durationS: result.durationS,
        geometry: result.geometry,
        routing: result.routing,
      };
    },
  );

  app.post(
    '/geo/moto/check',
    {
      schema: {
        tags: ['geo'],
        summary: 'Vérifier qu’une course moto ne traverse aucune zone interdite',
        body: motoCheckBodySchema,
        response: { 200: motoCheckResponseSchema },
      },
    },
    async (request) => service.checkMotoRoute(request.body),
  );
};
