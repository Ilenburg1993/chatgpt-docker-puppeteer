// Declaração mínima de módulo para suprimir TS7016 em testes com supertest.
// supertest não distribui @types; esta declaração satisfaz noImplicitAny.
declare module 'supertest';
