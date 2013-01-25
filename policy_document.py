import base64
import hmac, sha

policy_document = '{"expiration": "2015-01-01T00:00:00Z", "conditions": [ {"bucket": "gifpop-uploads"}, {"x-amz-acl": "public-read"}, ["starts-with", "$key", "uploads/"], ["starts-with", "$Content-Type", "image"], {"success_action_redirect": "http://gifbot.gifpop.io/uploaded/"}, ["content-length-range", 0, 20971520] ] }'
aws_secret_key = 'BX44PYr4WYOOtKE732cDB0635oChIamf8x5u38A1'

policy = base64.b64encode(policy_document)

signature = base64.b64encode(hmac.new(aws_secret_key, policy, sha).digest())

print(policy)
print('   ')
print(signature)