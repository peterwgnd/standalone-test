FROM python:3.12-slim

WORKDIR /app

# Install Node.js 22.x, npm, Git, and required build tools
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

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
