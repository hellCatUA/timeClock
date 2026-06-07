FROM python:3.11-slim

WORKDIR /app

COPY server.py .
COPY public/ ./public/

ENV PORT=3000
ENV DB_PATH=/data/timeclock.db

VOLUME ["/data"]

EXPOSE 3000

CMD ["python3", "server.py"]
