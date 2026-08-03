FROM python:3.12-slim

WORKDIR /app

# Install Git and required build tools (no unverified shell scripts)
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Securely vendor Node.js 22 and npm directly from the official Node Docker image
COPY --from=node:22-slim /usr/local/bin /usr/local/bin
COPY --from=node:22-slim /usr/local/lib/node_modules /usr/local/lib/node_modules

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

# Pull the latest 'src' directly from the public repository
RUN git clone --depth 1 https://github.com/Jigsaw-Code/sensemaking-tools.git /tmp/repo \
    && mv /tmp/repo/src /app/src \
    && rm -rf /tmp/repo

# Copy the application files
COPY . .

# Default Execution state
WORKDIR /app
ENTRYPOINT ["python", "survey_analytics_orchestrator.py", "-o", "/tmp"]
