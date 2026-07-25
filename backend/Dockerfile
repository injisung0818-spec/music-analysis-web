FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
COPY requirements-optional.txt /app/requirements-optional.txt

RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt \
    && pip install -r /app/requirements-optional.txt

COPY app /app/app

RUN mkdir -p /app/storage/uploads /app/storage/jobs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
