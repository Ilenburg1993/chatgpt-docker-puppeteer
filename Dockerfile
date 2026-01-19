# 1. Base ultra-leve
FROM node:20-slim

# 2. Instalar apenas o essencial para o Node e rede
RUN apt-get update && apt-get install -y \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Cache de dependências (Instala antes de copiar o código)
COPY package*.json ./
RUN npm install --production

# 4. Copiar a estrutura modular completa (Cérebro, Músculos, Nervos)
COPY src/ ./src/
COPY index.js .
COPY server.js .
COPY config.json .
COPY dynamic_rules.json .
COPY vocabulary.json .

# 5. Criar diretórios de persistência
RUN mkdir -p fila respostas logs

# 6. Variáveis de Ambiente para o Orchestrator
# 'host.docker.internal' permite que o container fale com o Windows
ENV CHROME_URL="http://host.docker.internal:9222"
ENV NODE_ENV="production"

# 7. Volume para não perder dados ao desligar o container
VOLUME ["/app/fila", "/app/respostas", "/app/logs"]

# Dashboard na 3000
EXPOSE 3000

CMD ["node", "index.js"]