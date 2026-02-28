# Performance Signal Catalog

- `cpu`: hot paths, loops, serialização excessiva
- `memory`: retenção, growth suspeito, buffers long-lived
- `io`: disco/rede sem batching
- `cache`: miss elevado, invalidação ruim
- `event-loop`: bloqueio ou operações síncronas custosas
- `test-cost`: suite cara demais para o valor do gate
