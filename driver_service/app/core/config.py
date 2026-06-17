from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    JWT_SECRET: str
    ALGORITHM: str = "HS256"
    MQTT_HOST: str = "mosquitto"
    MQTT_PORT: int = 1883
    MQTT_USER: str = ""
    MQTT_PASSWORD: str = ""


settings = Settings()
