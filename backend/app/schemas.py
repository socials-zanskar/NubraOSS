from typing import Literal

from pydantic import BaseModel, Field


Environment = Literal["PROD", "UAT"]


class StartLoginRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=15)
    environment: Environment


class StartLoginResponse(BaseModel):
    flow_id: str
    next_step: Literal["otp"]
    masked_phone: str
    environment: Environment
    device_id: str
    message: str


class VerifyOtpRequest(BaseModel):
    flow_id: str
    otp: str = Field(min_length=4, max_length=8)


class VerifyOtpResponse(BaseModel):
    flow_id: str
    next_step: Literal["mpin"]
    message: str


class VerifyMpinRequest(BaseModel):
    flow_id: str
    mpin: str = Field(min_length=4, max_length=6)


class VerifyMpinResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_name: str
    account_id: str
    environment: Environment
    broker: Literal["Nubra"]
    expires_in: int
    message: str
