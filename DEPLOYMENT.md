<!-- ABOUT THE PROJECT -->
## About The Project

<!-- ![IMG_9371](https://github.com/HoseaCodes/Storm-Gate/assets/66652422/bde9f6a2-e64a-4994-b278-5634eba75c2a) -->

![Deployment](deployment.png)


Storm Gate is an advanced authentication API service meticulously crafted with Node.js, offering unparalleled security and reliability for user authentication processes. Now deployed on AWS Lambda with MongoDB Atlas, it leverages modern serverless infrastructure to ensure seamless performance, auto-scaling, and global availability. Featuring Azure AD integration for enterprise-grade authentication, the service provides developers with a powerful, production-ready tool to authenticate users with ease and confidence, safeguarding their applications from unauthorized access.

- ⚡ **Serverless auto-scaling**
- 🛡️ **Azure AD secure authentication**
- 🗂️ **Cloudinary media handling**
- 🔐 **JWT access + refresh token rotation**
- 🔄 **Continuous deployment pipeline using AWS ECR + Lambda**
- ☁️ **Global availability through API Gateway**

**🌐 Live Application**: Deployed on AWS Lambda (Serverless)

<p align="right">(<a href="#top">back to top</a>)</p>

### Built With

List the technologies, frameworks, and libraries that you used in your project.

- [NodeJS](https://nodejs.org/en)
- [ExpressJS](https://expressjs.com/)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- [Azure AD](https://azure.microsoft.com/en-us/services/active-directory/)
- [AWS Lambda](https://aws.amazon.com/lambda/) - Serverless deployment platform
- [AWS API Gateway](https://aws.amazon.com/api-gateway/)
- [AWS ECR](https://aws.amazon.com/ecr/)
- [Cloudinary](https://cloudinary.com/) - Image and video management
- [JWT](https://jwt.io/) - JSON Web Tokens for authentication
  
_Deprecated technologies:_
- ~~[Nginx](https://www.nginx.com/)~~ 
- ~~[AWS EC2](https://aws.amazon.com/ec2/)~~

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- DEPLOYMENT -->
## Deployment

Storm Gate is successfully deployed and running on **AWS Lambda** (Serverless) using a Docker image.

### Deployment Information

- **🌐 Platform**: AWS Lambda (Serverless)
- **🏥 Health Check**: Available via Lambda function invocation
- **📚 API Documentation**: Available via Lambda function endpoints
- **🚀 Deployment**: One-command deployment with `./deploy-lambda-complete.sh`

### Quick Deployment Commands

```bash
# Clean up any existing resources and deploy fresh
./cleanup-lambda.sh --force
./deploy-lambda-complete.sh
```

### Lambda Only Updates

```bash
# Update Lambda function only, keep existing API Gateway
./deploy-lambda-complete.sh --skip-api-gateway
```

### Common Deployment Issues & Solutions

During deployment, we encountered and resolved several critical issues:

#### 1. MongoDB Connection Error
**Problem**: The app was trying to connect to `::1:27017` (localhost) instead of MongoDB Atlas.

**Solution**: Properly configured the `MONGODB_URL` environment variable to point to the MongoDB Atlas cluster.

#### 2. Network Binding Issue
**Problem**: The server was not listening on the correct interface for containerized environments.

**Solution**: Fixed the server to bind to `0.0.0.0:8080` instead of just `localhost`:

```javascript
// Fixed server binding in src/server.js
app.listen(port, '0.0.0.0', function () {
  console.log(`Express app running on port: ${port}`);
});
```

#### 3. Docker Build Dependencies
**Problem**: Native modules like `jpegtran-bin` required build tools for compilation.

**Solution**: Updated Dockerfile to include necessary build dependencies:

```dockerfile
# Install build dependencies for native modules
RUN apk add --no-cache \
    gcc \
    g++ \
    make \
    python3 \
    autoconf \
    automake \
    libtool \
    nasm \
    libpng-dev \
    libjpeg-turbo-dev
```

### Environment Variables

The following environment variables are properly configured in production:

- `MONGODB_URL` - MongoDB Atlas connection string
- `ACCESS_TOKEN_SECRET` & `REFRESH_TOKEN_SECRET` - JWT token secrets
- `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` - Azure AD configuration
- `EMAIL_USER`, `EMAIL_PASS`, `ADMIN_EMAIL` - Email service configuration
- `CLOUND_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET` - Cloudinary configuration
- `BASE_URL`, `REDIRECT_URI` - Application URLs
- `NODE_ENV` - Set to `production`

### Deployment Features

✅ **Auto-scaling**: AWS Lambda automatically scales from 0 to thousands of requests  
✅ **Health Monitoring**: CloudWatch monitoring and logging built-in  
✅ **Environment Security**: All sensitive data properly configured as Lambda environment variables  
✅ **Production Ready**: Optimized Docker container with Lambda runtime  
✅ **Azure AD Integration**: Full OAuth authentication flow configured for production  

### Post-Deployment Requirements

**Important**: After deployment, make sure to update your Azure AD app registration:

1. Go to your Azure AD app registration
2. Navigate to "Authentication" settings
3. Add your Lambda function URL or API Gateway URL for the redirect URI
4. Save the configuration

### Monitoring & Maintenance

Monitor your application using AWS CLI and CloudWatch:

```bash
# Check Lambda function status
aws lambda get-function --function-name storm-gate --region us-east-1

# View real-time logs
aws logs tail /aws/lambda/storm-gate --follow --region us-east-1

# Test Lambda function
aws lambda invoke --function-name storm-gate --payload '{"httpMethod":"GET","path":"/health"}' response.json

# Deploy updates
./deploy-lambda-complete.sh
```

### Deployment Architecture

- **Platform**: AWS Lambda (Serverless computing platform)
- **Runtime**: Node.js 18 (Lambda container runtime)
- **Database**: MongoDB Atlas (Cloud database)
- **Authentication**: Azure AD (Enterprise identity platform)
- **File Storage**: Cloudinary (Image and video management)
- **Email Service**: Gmail SMTP (Transactional emails)
- **Container Registry**: AWS ECR (Elastic Container Registry)

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- USAGE -->
## Usage

Provide examples, use cases, or detailed instructions on how to use your project. Include code snippets or screenshots if applicable.

For more examples, please refer to the [Documentation](https://example.com).

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- RELEASE -->
## Release History

See [Change Log](CHANGELOG.md)

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

Outline the future plans and enhancements you have for the project. You can list completed tasks and upcoming features.

- [x] ~~Deploy on EC2~~ (Legacy deployment)
- [x] **Deploy on AWS Lambda** (Current serverless deployment)
- [x] **MongoDB Atlas Integration** (Cloud database)
- [x] **Azure AD Authentication** (Enterprise identity)
- [x] **Cloudinary Integration** (Image management)
- [x] **Auto-scaling Infrastructure** (AWS Lambda serverless)
- [x] **Production Environment Variables** (Secure secrets management)
- [x] **Health Monitoring & API Documentation** (Operational readiness)
<!-- - [ ] Feature 3 -->
<!-- - [ ] Feature 4
  - [ ] Sub Feature 1
  - [ ] Sub Feature 2 -->

See the [open issues](https://github.com/your_username/Storm-Gate/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#top">back to top</a>)</p>
