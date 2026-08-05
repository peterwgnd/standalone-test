FROM python:3.12-slim

WORKDIR /app

# Install Git and Node.js 22 natively via official NodeSource repository (avoids multi-stage binary glibc mismatch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

# Pull the latest 'src' directly from the public repository
RUN git clone --depth 1 https://github.com/Jigsaw-Code/sensemaking-tools.git /tmp/repo \
    && mv /tmp/repo/src /app/src \
    && rm -rf /tmp/repo \
    && cd /app/src/report_ui && npm install

# Copy the application files
COPY . .

# Default Execution state
WORKDIR /app
ENTRYPOINT ["python", "survey_analytics_orchestrator.py", "-o", "/tmp"]
