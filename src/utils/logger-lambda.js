import winston from "winston";

// Simple function to return the current date and time
const timeStamp = () => {
  return new Date(Date.now()).toUTCString();
};

// Lambda-compatible Custom Logger class
class CustomLogger {
  constructor(service) {
    this.log_data = null;
    this.service = service;

    // Detect if running in Lambda environment
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    
    const transports = [];
    
    if (isLambda) {
      // Lambda: Only use console transport (CloudWatch handles log collection)
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf((info) => {
              return `${info.timestamp} | ${info.level} | ${info.message} | From: ${service} controller`;
            })
          )
        })
      );
    } else {
      // Local: Use both file and console transports
      transports.push(
        new winston.transports.File({
          filename: `./logs/allLogs.log`,
        }),
        new winston.transports.Console()
      );
    }

    const logger = winston.createLogger({
      transports: transports,
      format: winston.format.printf((info) => {
        // Custom message format
        let message = `${timeStamp()} | ${info.level} | ${info.message} | From: ${service} controller`;
        return message;
      }),
    });

    this.logger = logger;
  }

  setLogData(log_data) {
    this.log_data = log_data;
  }

  async info(message, obj = null) {
    if (obj) {
      this.logger.log("info", message, { obj });
    } else {
      this.logger.log("info", message);
    }
  }

  async debug(message, obj = null) {
    if (obj) {
      this.logger.log("debug", message, { obj });
    } else {
      this.logger.log("debug", message);
    }
  }

  async error(message, obj = null) {
    if (obj) {
      this.logger.log("error", message, { obj });
    } else {
      this.logger.log("error", message);
    }
  }
}

export default CustomLogger;
